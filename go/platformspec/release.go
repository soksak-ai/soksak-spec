package platformspec

import (
	"fmt"
	"regexp"
	"sort"
)

// GitHubOrg is the organization every release is published under:
// source.repository is https://github.com/<GitHubOrg>/<id>.
const GitHubOrg = "soksak-ai"

// IntegrityReference names a file inside the same release directory.
// File is a bare filename; the location is derived by the resolver.
type IntegrityReference struct {
	File   string `json:"file"`
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

// ReleaseReference points at another release; Size and SHA256 are of that
// release's release.json.
type ReleaseReference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
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

// releaseFilePattern is the file grammar of release.schema.json $defs.file; "." and ".."
// are excluded in validateIntegrity.
var releaseFilePattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
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
	if value.Source.Repository != "https://github.com/"+GitHubOrg+"/"+value.ID || !commitPattern.MatchString(value.Source.Commit) {
		return fmt.Errorf("release requires the source https://github.com/%s/%s at an exact commit", GitHubOrg, value.ID)
	}
	manifest := value.Kind + ".json"
	if err := validateIntegrity(value.Manifest); err != nil || value.Manifest.File != manifest {
		return fmt.Errorf("invalid release manifest reference")
	}
	if len(value.Artifacts) == 0 || len(value.Evidence) == 0 {
		return fmt.Errorf("release requires artifacts and evidence")
	}
	targets := make([]string, 0, len(value.Artifacts))
	for _, artifact := range value.Artifacts {
		if err := validateIntegrity(artifact.IntegrityReference); err != nil || (artifact.Format != "tgz" && artifact.Format != "tar.gz") || artifact.Manifest != manifest {
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
		if err := validateIntegrity(evidence); err != nil {
			return fmt.Errorf("invalid release evidence")
		}
	}
	if value.RuntimeDependencies != nil {
		if value.Kind != "plugin" && value.Kind != "sidecar" {
			return fmt.Errorf("runtime dependencies are allowed only on plugins and sidecars")
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

func validateIntegrity(value IntegrityReference) error {
	if !releaseFilePattern.MatchString(value.File) || value.File == "." || value.File == ".." || !validDigest(value.Size, value.SHA256) {
		return fmt.Errorf("invalid integrity reference")
	}
	return nil
}
func validDigest(size int64, sha256 string) bool {
	return size > 0 && digestPattern.MatchString(sha256)
}
func validateReferences(values []ReleaseReference, kind string) error {
	keys := make([]string, 0, len(values))
	for _, value := range values {
		if !idPattern.MatchString(value.ID) || !strictSemver(value.Version) || !validDigest(value.Size, value.SHA256) {
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
