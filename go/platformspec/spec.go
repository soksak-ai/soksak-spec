package platformspec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
)

const EnvironmentFile = "environment.json"

type Reference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}
type SidecarManifest struct {
	ID      string `json:"id"`
	Version string `json:"version"`
	// Interfaces lists every contract this sidecar serves; the first entry is
	// its primary role. One sidecar, several contracts — a terminal engine
	// also serves the surface channel.
	Interfaces []Reference `json:"interface"`
	Process    string      `json:"process"`
}

const (
	RegistrySource    = "registry"
	LocalSource       = "local"
	DevelopmentSource = "development"
)

type Component struct {
	Version        string `json:"version"`
	Path           string `json:"path"`
	ArtifactSHA256 string `json:"artifactSha256"`
	Source         string `json:"source"`
	Registry       string `json:"registry,omitempty"`
	Target         string `json:"target,omitempty"`
}
type Plugin struct {
	Component
	Enabled bool `json:"enabled"`
}
type Environment struct {
	Revision uint64               `json:"revision"`
	Plugins  map[string]Plugin    `json:"plugins"`
	Sidecars map[string]Component `json:"sidecars"`
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,127}$`)
var registryPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,63}$`)

func decode(body []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("trailing JSON data")
	}
	return nil
}
func ParseSidecarManifest(body []byte) (SidecarManifest, error) {
	var value SidecarManifest
	if err := decode(body, &value); err != nil {
		return SidecarManifest{}, err
	}
	process := "dist/" + value.ID
	if !idPattern.MatchString(value.ID) || !strictSemver(value.Version) || len(value.Interfaces) == 0 || (value.Process != process && value.Process != process+".exe") {
		return SidecarManifest{}, fmt.Errorf("invalid sidecar manifest")
	}
	seen := map[string]bool{}
	for _, ref := range value.Interfaces {
		if !idPattern.MatchString(ref.ID) || !strictSemver(ref.Version) || seen[ref.ID] {
			return SidecarManifest{}, fmt.Errorf("invalid sidecar manifest")
		}
		seen[ref.ID] = true
	}
	return value, nil
}
func ParseEnvironment(body []byte) (Environment, error) {
	var value Environment
	if err := decode(body, &value); err != nil {
		return Environment{}, err
	}
	return value, ValidateEnvironment(value)
}
func ValidateEnvironment(value Environment) error {
	if value.Revision < 1 || value.Plugins == nil || value.Sidecars == nil {
		return fmt.Errorf("environment requires revision, plugins, and sidecars")
	}
	for id, plugin := range value.Plugins {
		if !idPattern.MatchString(id) {
			return fmt.Errorf("invalid plugin id")
		}
		if err := validComponent(plugin.Component, false); err != nil {
			return fmt.Errorf("plugin %s: %w", id, err)
		}
	}
	for id, item := range value.Sidecars {
		if !idPattern.MatchString(id) {
			return fmt.Errorf("invalid component id")
		}
		if err := validComponent(item, true); err != nil {
			return err
		}
	}
	return nil
}
func validComponent(value Component, sidecar bool) error {
	if !strictSemver(value.Version) || !filepath.IsAbs(value.Path) || filepath.Clean(value.Path) != value.Path {
		return fmt.Errorf("component requires exact version and absolute path")
	}
	switch value.Source {
	case RegistrySource:
		if !digestPattern.MatchString(value.ArtifactSHA256) {
			return fmt.Errorf("registry source requires artifact SHA-256")
		}
		if !registryPattern.MatchString(value.Registry) {
			return fmt.Errorf("registry source requires registry id")
		}
	case LocalSource:
		if !digestPattern.MatchString(value.ArtifactSHA256) {
			return fmt.Errorf("local source requires artifact SHA-256")
		}
		if value.Registry != "" {
			return fmt.Errorf("local source cannot declare registry")
		}
	case DevelopmentSource:
		if value.ArtifactSHA256 != "" || value.Registry != "" {
			return fmt.Errorf("development source cannot declare artifact SHA-256 or registry")
		}
	default:
		return fmt.Errorf("invalid component source")
	}
	if sidecar && value.Target == "" {
		return fmt.Errorf("sidecar target required")
	}
	if !sidecar && value.Target != "" {
		return fmt.Errorf("target is sidecar-only")
	}
	return nil
}
func EmptyEnvironment() Environment {
	return Environment{Revision: 1, Plugins: map[string]Plugin{}, Sidecars: map[string]Component{}}
}
