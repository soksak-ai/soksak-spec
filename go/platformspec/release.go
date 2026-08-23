package platformspec

import (
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

type IntegrityReference struct {
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type ReleaseArtifact struct {
	IntegrityReference
	Target   string `json:"target"`
	Format   string `json:"format"`
	Manifest string `json:"manifest"`
}
type ReleaseSource struct{ Repository, Commit string }
type ReleaseReference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	IntegrityReference
}
type RuntimeDependencies struct {
	Plugins  []ReleaseReference `json:"plugins,omitempty"`
	Sidecars []ReleaseReference `json:"sidecars,omitempty"`
}
type ReleaseDocument struct {
	Kind                string               `json:"kind"`
	ID                  string               `json:"id"`
	Version             string               `json:"version"`
	Manifest            IntegrityReference   `json:"manifest"`
	Source              ReleaseSource        `json:"source"`
	Artifacts           []ReleaseArtifact    `json:"artifacts"`
	RuntimeDependencies *RuntimeDependencies `json:"runtimeDependencies,omitempty"`
	Evidence            []IntegrityReference `json:"evidence"`
}

var githubRepositoryPattern = regexp.MustCompile(`^https://github[.]com/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`)
var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var nativeTargets = map[string]bool{
	"aarch64-apple-darwin": true, "x86_64-apple-darwin": true,
	"aarch64-unknown-linux-gnu": true, "x86_64-unknown-linux-gnu": true,
	"x86_64-pc-windows-msvc": true,
}

func ParseReleaseManifest(body []byte) (ReleaseDocument, error) {
	var value ReleaseDocument
	if err := decode(body, &value); err != nil {
		return ReleaseDocument{}, err
	}
	if err := ValidateReleaseManifest(value); err != nil {
		return ReleaseDocument{}, err
	}
	return value, nil
}

func ValidateReleaseManifest(value ReleaseDocument) error {
	if !map[string]bool{"plugin": true, "sidecar": true, "kit": true, "contract": true, "spec": true}[value.Kind] {
		return fmt.Errorf("invalid release kind")
	}
	if !idPattern.MatchString(value.ID) || !strictSemver(value.Version) {
		return fmt.Errorf("release requires component id and exact version")
	}
	if !githubRepositoryPattern.MatchString(value.Source.Repository) || !commitPattern.MatchString(value.Source.Commit) {
		return fmt.Errorf("release requires canonical source")
	}
	manifest := value.Kind + ".json"
	if err := validateIntegrity(value.Manifest, value.Source.Repository, value.Version); err != nil || !strings.HasSuffix(value.Manifest.URL, "/"+manifest) {
		return fmt.Errorf("invalid release manifest reference")
	}
	if len(value.Artifacts) == 0 || len(value.Evidence) == 0 {
		return fmt.Errorf("release requires artifacts and evidence")
	}
	targets := make([]string, 0, len(value.Artifacts))
	for _, artifact := range value.Artifacts {
		if err := validateIntegrity(artifact.IntegrityReference, value.Source.Repository, value.Version); err != nil || (artifact.Format != "tgz" && artifact.Format != "tar.gz") || artifact.Manifest != manifest {
			return fmt.Errorf("invalid release artifact")
		}
		if value.Kind == "sidecar" {
			if !nativeTargets[artifact.Target] {
				return fmt.Errorf("sidecar artifact requires native target")
			}
		} else if artifact.Target != "any" {
			return fmt.Errorf("portable artifact requires any target")
		}
		targets = append(targets, artifact.Target)
	}
	if !sort.StringsAreSorted(targets) || duplicates(targets) || (value.Kind != "sidecar" && len(targets) != 1) {
		return fmt.Errorf("release artifact targets must be unique and sorted")
	}
	for _, evidence := range value.Evidence {
		if err := validateIntegrity(evidence, value.Source.Repository, value.Version); err != nil {
			return fmt.Errorf("invalid release evidence")
		}
	}
	if value.RuntimeDependencies != nil {
		if value.Kind != "plugin" && value.Kind != "sidecar" {
			return fmt.Errorf("runtime dependencies belong only to plugins and sidecars")
		}
		if len(value.RuntimeDependencies.Plugins)+len(value.RuntimeDependencies.Sidecars) == 0 {
			return fmt.Errorf("runtime dependencies cannot be empty")
		}
		if err := validateReferences(value.RuntimeDependencies.Plugins, "plugin"); err != nil {
			return err
		}
		if err := validateReferences(value.RuntimeDependencies.Sidecars, "sidecar"); err != nil {
			return err
		}
	}
	return nil
}

func validateIntegrity(value IntegrityReference, repository, version string) error {
	prefix := repository + "/releases/download/v" + version + "/"
	parsed, err := url.Parse(value.URL)
	if err != nil || !strings.HasPrefix(value.URL, prefix) || len(value.URL) <= len(prefix) || parsed.RawQuery != "" || parsed.Fragment != "" || value.Size <= 0 || !digestPattern.MatchString(value.SHA256) {
		return fmt.Errorf("invalid integrity reference")
	}
	return nil
}
func validateReferences(values []ReleaseReference, kind string) error {
	keys := make([]string, 0, len(values))
	for _, value := range values {
		if !idPattern.MatchString(value.ID) || !strictSemver(value.Version) || !strings.HasSuffix(value.URL, "/releases/download/v"+value.Version+"/release.json") || value.Size <= 0 || !digestPattern.MatchString(value.SHA256) {
			return fmt.Errorf("invalid %s release reference", kind)
		}
		keys = append(keys, value.ID+"@"+value.Version)
	}
	if !sort.StringsAreSorted(keys) || duplicates(keys) {
		return fmt.Errorf("%s release references must be unique and sorted", kind)
	}
	return nil
}
func duplicates(values []string) bool {
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			return true
		}
		seen[value] = true
	}
	return false
}
