package platformspec

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
)

const (
	SettingsFile  = "settings.json"
	InstalledFile = "installed.json"
)

type Reference struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}
type SidecarManifest struct {
	ID        string    `json:"id"`
	Version   string    `json:"version"`
	Interface Reference `json:"interface"`
	Process   string    `json:"process"`
}
type Development struct {
	Path string `json:"path"`
}
type PluginPreference struct {
	Enabled     bool              `json:"enabled"`
	Development *Development      `json:"development,omitempty"`
	Providers   map[string]string `json:"providers,omitempty"`
}
type ComponentPreference struct {
	Development *Development `json:"development,omitempty"`
}
type Settings struct {
	Revision  uint64                         `json:"revision"`
	Plugins   map[string]PluginPreference    `json:"plugins"`
	Sidecars  map[string]ComponentPreference `json:"sidecars"`
	Kits      map[string]ComponentPreference `json:"kits"`
	Contracts map[string]ComponentPreference `json:"contracts"`
	Specs     map[string]ComponentPreference `json:"specs"`
}
type InstalledComponent struct {
	Version        string `json:"version"`
	Path           string `json:"path"`
	RegistryID     string `json:"registryId"`
	Repository     string `json:"repository"`
	SourceCommit   string `json:"sourceCommit"`
	ManifestSHA256 string `json:"manifestSha256"`
	ArtifactSHA256 string `json:"artifactSha256"`
	Target         string `json:"target,omitempty"`
}
type Installed struct {
	Revision  uint64                        `json:"revision"`
	Plugins   map[string]InstalledComponent `json:"plugins"`
	Sidecars  map[string]InstalledComponent `json:"sidecars"`
	Kits      map[string]InstalledComponent `json:"kits"`
	Contracts map[string]InstalledComponent `json:"contracts"`
	Specs     map[string]InstalledComponent `json:"specs"`
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,127}$`)
var digestPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var commitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

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
	if !idPattern.MatchString(value.ID) || !strictSemver(value.Version) || !idPattern.MatchString(value.Interface.ID) || value.Interface.Version != "0.0.1" || value.Process != "dist/"+value.ID {
		return SidecarManifest{}, fmt.Errorf("invalid sidecar manifest")
	}
	return value, nil
}
func ParseSettings(body []byte) (Settings, error) {
	var value Settings
	if err := decode(body, &value); err != nil {
		return Settings{}, err
	}
	return value, ValidateSettings(value)
}
func ValidateSettings(value Settings) error {
	if value.Revision < 1 || value.Plugins == nil || value.Sidecars == nil || value.Kits == nil || value.Contracts == nil || value.Specs == nil {
		return fmt.Errorf("settings requires revision and all component maps")
	}
	for id, plugin := range value.Plugins {
		if !idPattern.MatchString(id) {
			return fmt.Errorf("invalid plugin id")
		}
		if err := validDevelopment(plugin.Development); err != nil {
			return err
		}
		for name, provider := range plugin.Providers {
			if !idPattern.MatchString(name) || !idPattern.MatchString(provider) {
				return fmt.Errorf("invalid provider selection")
			}
		}
	}
	for _, values := range []map[string]ComponentPreference{value.Sidecars, value.Kits, value.Contracts, value.Specs} {
		for id, item := range values {
			if !idPattern.MatchString(id) {
				return fmt.Errorf("invalid component id")
			}
			if err := validDevelopment(item.Development); err != nil {
				return err
			}
		}
	}
	return nil
}
func validDevelopment(value *Development) error {
	if value != nil && (!filepath.IsAbs(value.Path) || filepath.Clean(value.Path) != value.Path) {
		return fmt.Errorf("development path must be absolute")
	}
	return nil
}
func EmptySettings() Settings {
	return Settings{Revision: 1, Plugins: map[string]PluginPreference{}, Sidecars: map[string]ComponentPreference{}, Kits: map[string]ComponentPreference{}, Contracts: map[string]ComponentPreference{}, Specs: map[string]ComponentPreference{}}
}
func ParseInstalled(body []byte) (Installed, error) {
	var value Installed
	if err := decode(body, &value); err != nil {
		return Installed{}, err
	}
	return value, ValidateInstalled(value)
}
func ValidateInstalled(value Installed) error {
	if value.Revision < 1 || value.Plugins == nil || value.Sidecars == nil || value.Kits == nil || value.Contracts == nil || value.Specs == nil {
		return fmt.Errorf("installed state requires revision and all component maps")
	}
	for kind, values := range map[string]map[string]InstalledComponent{"plugin": value.Plugins, "sidecar": value.Sidecars, "kit": value.Kits, "contract": value.Contracts, "spec": value.Specs} {
		for id, item := range values {
			if !idPattern.MatchString(id) || !strictSemver(item.Version) || !filepath.IsAbs(item.Path) || item.RegistryID == "" || item.Repository == "" || !commitPattern.MatchString(item.SourceCommit) || !digestPattern.MatchString(item.ManifestSHA256) || !digestPattern.MatchString(item.ArtifactSHA256) {
				return fmt.Errorf("invalid installed %s %s", kind, id)
			}
			if kind == "sidecar" && item.Target == "" {
				return fmt.Errorf("sidecar target required")
			}
		}
	}
	return nil
}
func EmptyInstalled() Installed {
	return Installed{Revision: 1, Plugins: map[string]InstalledComponent{}, Sidecars: map[string]InstalledComponent{}, Kits: map[string]InstalledComponent{}, Contracts: map[string]InstalledComponent{}, Specs: map[string]InstalledComponent{}}
}
