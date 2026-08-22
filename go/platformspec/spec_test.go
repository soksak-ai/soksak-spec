package platformspec

import (
	"encoding/json"
	"testing"
)

func TestSettingsAndInstalledKeepSeparateFacts(t *testing.T) {
	settings := EmptySettings()
	settings.Plugins["demo"] = PluginPreference{Enabled: true, Providers: map[string]string{"terminal": "terminal-provider"}}
	if err := ValidateSettings(settings); err != nil {
		t.Fatal(err)
	}
	installed := EmptyInstalled()
	installed.Plugins["demo"] = InstalledComponent{Version: "0.0.1", Path: "/installed/demo", RegistryID: "official", Repository: "https://github.com/example/demo", SourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ManifestSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
	if err := ValidateInstalled(installed); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{"revision": 1, "plugins": map[string]any{"demo": map[string]any{"enabled": true, "installPath": "/installed"}}, "sidecars": map[string]any{}, "kits": map[string]any{}, "contracts": map[string]any{}, "specs": map[string]any{}})
	if _, err := ParseSettings(body); err == nil {
		t.Fatal("settings accepted install path")
	}
}

func TestInstalledComponentsAcceptStrictPatchVersions(t *testing.T) {
	installed := EmptyInstalled()
	installed.Plugins["terminal-ghostty"] = InstalledComponent{
		Version: "0.0.2", Path: "/installed/ghostty", RegistryID: "official",
		Repository: "https://github.com/example/ghostty", SourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ManifestSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		ArtifactSHA256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
	}
	if err := ValidateInstalled(installed); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"0.0", "v0.0.2", "latest", "01.0.0"} {
		component := installed.Plugins["terminal-ghostty"]
		component.Version = version
		installed.Plugins["terminal-ghostty"] = component
		if err := ValidateInstalled(installed); err == nil {
			t.Errorf("accepted installed version %q", version)
		}
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
