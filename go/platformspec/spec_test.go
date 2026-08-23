package platformspec

import (
	"encoding/json"
	"testing"
)

func TestEnvironmentOwnsLocalMaterializationAndUserChoices(t *testing.T) {
	environment := EmptyEnvironment()
	environment.Plugins["soksak-plugin-browser-wails3"] = Plugin{Component: Component{Version: "0.0.1", Path: "/installed/browser", Source: RegistrySource, Registry: "official"}, Enabled: true}
	environment.Sidecars["terminal-provider"] = Component{Version: "0.0.2", Path: "/installed/terminal-provider", Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"}
	if err := ValidateEnvironment(environment); err != nil {
		t.Fatal(err)
	}
}

func TestPluginComponentErrorsNameTheFieldRatherThanTheID(t *testing.T) {
	environment := EmptyEnvironment()
	environment.Plugins["soksak-plugin-browser-wails3"] = Plugin{Component: Component{Version: "0.0.1", Path: "/installed/browser", Source: RegistrySource, Registry: "official", Target: "any"}}
	err := ValidateEnvironment(environment)
	if err == nil || err.Error() != "plugin soksak-plugin-browser-wails3: target belongs only to sidecars" {
		t.Fatalf("error = %v", err)
	}
}

func TestEnvironmentRejectsPluginSidecarBindings(t *testing.T) {
	body := []byte(`{"revision":1,"plugins":{"demo":{"version":"0.0.1","path":"/installed/demo","source":"registry","registry":"official","enabled":true,"sidecars":{"pty":"soksak-sidecar-pty"}}},"sidecars":{},"kits":{},"contracts":{},"specs":{}}`)
	if _, err := ParseEnvironment(body); err == nil {
		t.Fatal("plugin sidecar binding was accepted")
	}
}

func TestEnvironmentRejectsInvalidMaterialization(t *testing.T) {
	for _, version := range []string{"0.0", "v0.0.2", "latest", "01.0.0"} {
		environment := EmptyEnvironment()
		environment.Kits["demo"] = Component{Version: version, Path: "/installed/demo", Source: RegistrySource, Registry: "official"}
		if err := ValidateEnvironment(environment); err == nil {
			t.Errorf("accepted version %q", version)
		}
	}
	for name, component := range map[string]Component{
		"relative path":           {Version: "0.0.1", Path: "relative", Source: RegistrySource, Registry: "official"},
		"registry missing":        {Version: "0.0.1", Path: "/installed/demo", Source: RegistrySource},
		"registry on development": {Version: "0.0.1", Path: "/work/demo", Source: DevelopmentSource, Registry: "official"},
		"unknown source":          {Version: "0.0.1", Path: "/work/demo", Source: "local"},
	} {
		environment := EmptyEnvironment()
		environment.Kits["demo"] = component
		if err := ValidateEnvironment(environment); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
}

func TestEnvironmentIsTheOnlyLocalComponentDiscoveryDocument(t *testing.T) {
	if EnvironmentFile != "environment.json" {
		t.Fatalf("environment file=%q", EnvironmentFile)
	}
	environment := EmptyEnvironment()
	environment.Sidecars["pty"] = Component{Version: "0.0.1", Path: "/local/pty", Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"}
	body, err := json.Marshal(environment)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := ParseEnvironment(body)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Sidecars["pty"].Path != "/local/pty" {
		t.Fatalf("sidecar path=%q", parsed.Sidecars["pty"].Path)
	}
}

func TestSidecarManifestIsExact(t *testing.T) {
	body := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":{\"id\":\"terminal-state\",\"version\":\"0.0.1\"},\"process\":\"dist/terminal-provider\"}")
	if _, err := ParseSidecarManifest(body); err != nil {
		t.Fatal(err)
	}
	windows := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":{\"id\":\"terminal-state\",\"version\":\"0.0.1\"},\"process\":\"dist/terminal-provider.exe\"}")
	if _, err := ParseSidecarManifest(windows); err != nil {
		t.Fatal(err)
	}
	wrong := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":{\"id\":\"terminal-state\",\"version\":\"0.0.1\"},\"process\":\"dist/other.exe\"}")
	if _, err := ParseSidecarManifest(wrong); err == nil {
		t.Fatal("mismatched Windows process was accepted")
	}
}
