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

func TestSidecarManifestIsExact(t *testing.T) {
	body := []byte("{\"id\":\"terminal-provider\",\"version\":\"0.0.1\",\"interface\":{\"id\":\"terminal-state\",\"version\":\"0.0.1\"},\"process\":\"dist/terminal-provider\"}")
	if _, err := ParseSidecarManifest(body); err != nil {
		t.Fatal(err)
	}
}
