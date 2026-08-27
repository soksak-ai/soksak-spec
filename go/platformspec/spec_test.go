package platformspec

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEnvironmentOwnsLocalMaterializationAndUserChoices(t *testing.T) {
	environment := EmptyEnvironment()
	environment.Plugins["soksak-plugin-browser-wails3"] = Plugin{Component: Component{Version: "0.0.1", Path: "/installed/browser", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Registry: "official"}, Enabled: true}
	environment.Sidecars["terminal-provider"] = Component{Version: "0.0.2", Path: "/installed/terminal-provider", ArtifactSHA256: strings.Repeat("b", 64), Source: LocalSource, Target: "aarch64-apple-darwin"}
	if err := ValidateEnvironment(environment); err != nil {
		t.Fatal(err)
	}
}

func TestPluginComponentErrorsNameTheFieldRatherThanTheID(t *testing.T) {
	environment := EmptyEnvironment()
	environment.Plugins["soksak-plugin-browser-wails3"] = Plugin{Component: Component{Version: "0.0.1", Path: "/installed/browser", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Registry: "official", Target: "any"}}
	err := ValidateEnvironment(environment)
	if err == nil || err.Error() != "plugin soksak-plugin-browser-wails3: target is sidecar-only" {
		t.Fatalf("error = %v", err)
	}
}

func TestEnvironmentRejectsPluginSidecarBindings(t *testing.T) {
	body := []byte(`{"revision":1,"plugins":{"demo":{"version":"0.0.1","path":"/installed/demo","artifactSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","source":"registry","registry":"official","enabled":true,"sidecars":{"pty":"soksak-sidecar-pty"}}},"sidecars":{}}`)
	if _, err := ParseEnvironment(body); err == nil {
		t.Fatal("plugin sidecar binding was accepted")
	}
}

func TestEnvironmentRejectsInvalidMaterialization(t *testing.T) {
	for _, version := range []string{"0.0", "v0.0.2", "latest", "01.0.0"} {
		environment := EmptyEnvironment()
		environment.Sidecars["demo"] = Component{Version: version, Path: "/installed/demo", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"}
		if err := ValidateEnvironment(environment); err == nil {
			t.Errorf("accepted version %q", version)
		}
	}
	for name, component := range map[string]Component{
		"relative path":     {Version: "0.0.1", Path: "relative", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"},
		"registry missing":  {Version: "0.0.1", Path: "/installed/demo", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Target: "aarch64-apple-darwin"},
		"registry on local": {Version: "0.0.1", Path: "/work/demo", ArtifactSHA256: strings.Repeat("a", 64), Source: LocalSource, Registry: "official", Target: "aarch64-apple-darwin"},
		"unknown source":    {Version: "0.0.1", Path: "/work/demo", ArtifactSHA256: strings.Repeat("a", 64), Source: "unknown", Target: "aarch64-apple-darwin"},
	} {
		environment := EmptyEnvironment()
		environment.Sidecars["demo"] = component
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
	environment.Sidecars["pty"] = Component{Version: "0.0.1", Path: "/local/pty", ArtifactSHA256: strings.Repeat("a", 64), Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"}
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
	body := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":[{\"id\":\"terminal-state\",\"version\":\"0.0.1\"}],\"process\":\"dist/terminal-provider\"}")
	if _, err := ParseSidecarManifest(body); err != nil {
		t.Fatal(err)
	}
	windows := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":[{\"id\":\"terminal-state\",\"version\":\"0.0.1\"}],\"process\":\"dist/terminal-provider.exe\"}")
	if _, err := ParseSidecarManifest(windows); err != nil {
		t.Fatal(err)
	}
	wrong := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":[{\"id\":\"terminal-state\",\"version\":\"0.0.1\"}],\"process\":\"dist/other.exe\"}")
	if _, err := ParseSidecarManifest(wrong); err == nil {
		t.Fatal("mismatched Windows process was accepted")
	}
}

func TestDevelopmentRecordHasNoArtifactAndNoRegistry(t *testing.T) {
	environment := EmptyEnvironment()
	environment.Plugins["demo"] = Plugin{Component: Component{Version: "0.0.1", Path: "/work/demo", Source: DevelopmentSource}, Enabled: true}
	environment.Sidecars["terminal-provider"] = Component{Version: "0.0.2", Path: "/work/terminal-provider", Source: DevelopmentSource, Target: "aarch64-apple-darwin"}
	if err := ValidateEnvironment(environment); err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"revision":1,"plugins":{"demo":{"version":"0.0.1","path":"/work/demo","artifactSha256":"","source":"development","enabled":true}},"sidecars":{}}`)
	if _, err := ParseEnvironment(body); err != nil {
		t.Fatal(err)
	}
}

func TestDevelopmentRecordRejectsArtifactRegistryAndMissingTarget(t *testing.T) {
	for name, component := range map[string]Component{
		"artifact on development": {Version: "0.0.1", Path: "/work/demo", ArtifactSHA256: strings.Repeat("a", 64), Source: DevelopmentSource},
		"registry on development": {Version: "0.0.1", Path: "/work/demo", Source: DevelopmentSource, Registry: "official"},
		"relative path":           {Version: "0.0.1", Path: "relative", Source: DevelopmentSource},
		"loose version":           {Version: "v0.0.1", Path: "/work/demo", Source: DevelopmentSource},
	} {
		environment := EmptyEnvironment()
		environment.Plugins["demo"] = Plugin{Component: component}
		if err := ValidateEnvironment(environment); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
	environment := EmptyEnvironment()
	environment.Sidecars["demo"] = Component{Version: "0.0.1", Path: "/work/demo", Source: DevelopmentSource}
	if err := ValidateEnvironment(environment); err == nil {
		t.Error("accepted development sidecar without target")
	}
}

func TestRegistryAndLocalStillRequireArtifactDigest(t *testing.T) {
	for name, component := range map[string]Component{
		"registry without digest": {Version: "0.0.1", Path: "/installed/demo", Source: RegistrySource, Registry: "official", Target: "aarch64-apple-darwin"},
		"local without digest":    {Version: "0.0.1", Path: "/installed/demo", Source: LocalSource, Target: "aarch64-apple-darwin"},
	} {
		environment := EmptyEnvironment()
		environment.Sidecars["demo"] = component
		if err := ValidateEnvironment(environment); err == nil {
			t.Errorf("accepted %s", name)
		}
	}
}

// A sidecar declares which version of its wire it implements. The grammar bounds the shape of that
// declaration, not the number: a parser that pinned one number would refuse every unit the day a
// wire moved, and which numbers exist is the wire contract's to say, not this grammar's.
func TestSidecarManifestAcceptsAnyStrictInterfaceVersion(t *testing.T) {
	manifest := func(version string) []byte {
		return []byte(`{"id":"unit","version":"0.0.14","interface":[{"id":"wire","version":"` +
			version + `"}],"process":"dist/unit"}`)
	}
	for _, version := range []string{"0.0.1", "0.0.2", "1.2.3", "0.0.2-rc.1"} {
		if _, err := ParseSidecarManifest(manifest(version)); err != nil {
			t.Errorf("interface %s: %v", version, err)
		}
	}
	for _, version := range []string{"", "v0.0.2", "0.0", "0.0.02"} {
		if _, err := ParseSidecarManifest(manifest(version)); err == nil {
			t.Errorf("interface %q was accepted", version)
		}
	}
}
