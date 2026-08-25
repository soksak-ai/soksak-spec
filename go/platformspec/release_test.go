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
		"manifest":  map[string]any{"file": manifest, "size": 1, "sha256": strings.Repeat("a", 64)},
		"source":    map[string]any{"repository": repository, "commit": strings.Repeat("b", 40)},
		"artifacts": []any{map[string]any{"target": target, "file": "archive.tar.gz", "size": 2, "sha256": strings.Repeat("c", 64), "format": format, "manifest": manifest}},
		"evidence":  []any{map[string]any{"file": "report.json", "size": 3, "sha256": strings.Repeat("d", 64)}},
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
func rejects(t *testing.T, name string, value map[string]any) {
	t.Helper()
	if _, err := ParseReleaseManifest(encoded(t, value)); err == nil {
		t.Fatalf("%s accepted", name)
	}
}
func TestReleaseManifestUsesTheFlatShapeForEveryKind(t *testing.T) {
	for _, kind := range []string{"plugin", "sidecar", "kit", "contract", "spec"} {
		if _, err := ParseReleaseManifest(encoded(t, releaseFixture(kind))); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
}
func TestReleaseManifestRejectsNestedIdentityReportsAndWrongTargets(t *testing.T) {
	nested := releaseFixture("plugin")
	nested["plugin"] = map[string]any{"id": "old"}
	rejects(t, "nested identity", nested)
	reports := releaseFixture("plugin")
	reports["reports"] = reports["evidence"]
	delete(reports, "evidence")
	rejects(t, "reports", reports)
	wrong := releaseFixture("plugin")
	wrong["artifacts"].([]any)[0].(map[string]any)["target"] = "aarch64-apple-darwin"
	rejects(t, "native plugin target", wrong)
}
func TestReleaseManifestBindsSourceRepositoryToTheOrgAndID(t *testing.T) {
	for name, repository := range map[string]string{
		"fork owner":       "https://github.com/example/soksak-plugin-example",
		"id mismatch":      "https://github.com/soksak-ai/soksak-sidecar-example",
		"git suffix":       "https://github.com/soksak-ai/soksak-plugin-example.git",
		"trailing slash":   "https://github.com/soksak-ai/soksak-plugin-example/",
		"plain http":       "http://github.com/soksak-ai/soksak-plugin-example",
		"upper-case owner": "https://github.com/Soksak-AI/soksak-plugin-example",
	} {
		value := releaseFixture("plugin")
		value["source"] = map[string]any{"repository": repository, "commit": strings.Repeat("b", 40)}
		rejects(t, name, value)
	}
}
func TestReleaseManifestFileNamesFollowOneGrammar(t *testing.T) {
	for _, file := range []string{".", "..", "a b", "x?y", "x#y", "r\u00e9port.json", "%2e%2e", "report/../x"} {
		value := releaseFixture("plugin")
		value["evidence"] = []any{map[string]any{"file": file, "size": 3, "sha256": strings.Repeat("d", 64)}}
		rejects(t, "file "+file, value)
	}
	for _, file := range []string{"a", "...", ".hidden", "Report_1.tar.gz", "a-b_c.d"} {
		value := releaseFixture("plugin")
		value["evidence"] = []any{map[string]any{"file": file, "size": 3, "sha256": strings.Repeat("d", 64)}}
		if _, err := ParseReleaseManifest(encoded(t, value)); err != nil {
			t.Fatalf("file %s: %v", file, err)
		}
	}
}
func TestReleaseManifestRejectsURLAndNonBareFileNames(t *testing.T) {
	withURL := releaseFixture("plugin")
	withURL["evidence"] = []any{map[string]any{"url": "https://github.com/soksak-ai/x/releases/download/v0.0.1/report.json", "file": "report.json", "size": 3, "sha256": strings.Repeat("d", 64)}}
	rejects(t, "url on integrity reference", withURL)
	slash := releaseFixture("plugin")
	slash["evidence"] = []any{map[string]any{"file": "reports/report.json", "size": 3, "sha256": strings.Repeat("d", 64)}}
	rejects(t, "file with slash", slash)
	empty := releaseFixture("plugin")
	empty["evidence"] = []any{map[string]any{"file": "", "size": 3, "sha256": strings.Repeat("d", 64)}}
	rejects(t, "empty file", empty)
	digest := releaseFixture("plugin")
	digest["evidence"] = []any{map[string]any{"file": "report.json", "size": 3, "sha256": "abc"}}
	rejects(t, "short digest", digest)
	size := releaseFixture("plugin")
	size["evidence"] = []any{map[string]any{"file": "report.json", "size": 0, "sha256": strings.Repeat("d", 64)}}
	rejects(t, "zero size", size)
}
func TestReleaseManifestRequiresTheKindManifestFile(t *testing.T) {
	other := releaseFixture("plugin")
	other["manifest"] = map[string]any{"file": "sidecar.json", "size": 1, "sha256": strings.Repeat("a", 64)}
	rejects(t, "manifest file of another kind", other)
	artifact := releaseFixture("plugin")
	artifact["artifacts"].([]any)[0].(map[string]any)["manifest"] = "sidecar.json"
	rejects(t, "artifact manifest of another kind", artifact)
}
func TestReleaseManifestRuntimeDependenciesAreReleaseReferences(t *testing.T) {
	reference := func(id string) map[string]any {
		return map[string]any{"id": id, "version": "0.0.1", "size": 4, "sha256": strings.Repeat("e", 64)}
	}
	ok := releaseFixture("plugin")
	ok["runtimeDependencies"] = map[string]any{"plugins": []any{reference("a-plugin"), reference("b-plugin")}, "sidecars": []any{reference("a-sidecar")}}
	if _, err := ParseReleaseManifest(encoded(t, ok)); err != nil {
		t.Fatal(err)
	}
	withURL := releaseFixture("plugin")
	url := reference("a-plugin")
	url["url"] = "https://github.com/soksak-ai/a-plugin/releases/download/v0.0.1/release.json"
	withURL["runtimeDependencies"] = map[string]any{"plugins": []any{url}}
	rejects(t, "url on release reference", withURL)
	unsorted := releaseFixture("plugin")
	unsorted["runtimeDependencies"] = map[string]any{"plugins": []any{reference("b-plugin"), reference("a-plugin")}}
	rejects(t, "unsorted release references", unsorted)
	kit := releaseFixture("kit")
	kit["runtimeDependencies"] = map[string]any{"plugins": []any{reference("a-plugin")}}
	rejects(t, "runtime dependencies on kit", kit)
}
