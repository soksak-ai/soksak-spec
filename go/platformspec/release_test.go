package platformspec

import (
	"encoding/json"
	"strings"
	"testing"
)

func releaseFixture(kind string) map[string]any {
	id := "soksak-" + kind + "-example"
	repository := "https://github.com/soksak-ai/" + id
	manifest := kind + ".json"
	target := "any"
	format := "tgz"
	if kind == "sidecar" {
		target = "aarch64-apple-darwin"
		format = "tar.gz"
	}
	return map[string]any{
		"kind": kind, "id": id, "version": "0.0.1",
		"manifest":  map[string]any{"url": repository + "/releases/download/v0.0.1/" + manifest, "size": 1, "sha256": strings.Repeat("a", 64)},
		"source":    map[string]any{"repository": repository, "commit": strings.Repeat("b", 40)},
		"artifacts": []any{map[string]any{"target": target, "url": repository + "/releases/download/v0.0.1/archive.tar.gz", "size": 2, "sha256": strings.Repeat("c", 64), "format": format, "manifest": manifest}},
		"evidence":  []any{map[string]any{"url": repository + "/releases/download/v0.0.1/report.json", "size": 3, "sha256": strings.Repeat("d", 64)}},
	}
}
func encoded(t *testing.T, value any) []byte {
	t.Helper()
	body, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
func TestReleaseManifestUsesTheFlatShapeForEveryKind(t *testing.T) {
	for _, kind := range []string{"plugin", "sidecar", "kit", "contract", "spec"} {
		if _, err := ParseReleaseManifest(encoded(t, releaseFixture(kind))); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
}
func TestReleaseManifestRejectsLegacyAndWrongTargets(t *testing.T) {
	legacy := releaseFixture("plugin")
	legacy["plugin"] = map[string]any{"id": "old"}
	if _, err := ParseReleaseManifest(encoded(t, legacy)); err == nil {
		t.Fatal("nested identity accepted")
	}
	reports := releaseFixture("plugin")
	reports["reports"] = reports["evidence"]
	delete(reports, "evidence")
	if _, err := ParseReleaseManifest(encoded(t, reports)); err == nil {
		t.Fatal("reports accepted")
	}
	wrong := releaseFixture("plugin")
	wrong["artifacts"].([]any)[0].(map[string]any)["target"] = "aarch64-apple-darwin"
	if _, err := ParseReleaseManifest(encoded(t, wrong)); err == nil {
		t.Fatal("native plugin target accepted")
	}
}
