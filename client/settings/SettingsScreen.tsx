// The plugin's settings screen, built from the host's Settings* components: a Safety section bound to `safetySettings`
// (each dangerous switch with its warning, the protected-branch patterns, safety snapshots) and a View section bound to
// `viewSettings`. Both documents belong to the host (shared/settings.ts). Each section handles its document's
// loading, invalid and error states, and a save that fails (a conflict with another client's save, an invalid value)
// keeps what is shown and says why, as the SDK's "Persisted values" asks.

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import type { SettingsState } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { PROTECTED_BRANCHES_MAX } from "../../shared/limits.ts";
import { SAFETY_SWITCHES, safetySettings, viewSettings } from "../../shared/settings.ts";
import type { SafetyPolicy, SafetySwitch, ViewPreferences } from "../../shared/settings.ts";
import { useT } from "../i18n/messages.ts";
import { HostProvider } from "../state/host.ts";
import { T } from "../ui/Text.tsx";
import { useTheme } from "../ui/theme.ts";

export function SettingsScreen({ theme, layout, host }: PluginSurfaceProps) {
  const value = useMemo(() => ({ theme, layout, host: { id: host.id, label: host.label } }), [theme, layout, host.id, host.label]);
  return (
    <HostProvider value={value}>
      <View testID="ag-settings" key={host.id}>
        <SafetySection />
        <ViewSection />
      </View>
    </HostProvider>
  );
}

type Loaded<Values> = { status: "ready"; values: Values; revision: string; saving: boolean; saveError: string | null; save(values: Values, revision: string): Promise<boolean> };

/** A document that is not ready: loading, unreadable, or invalid (with a way to reset it). */
function NotReady({ state, title, testID }: { state: SettingsState<typeof safetySettings.schema> | SettingsState<typeof viewSettings.schema>; title: string; testID: string }) {
  const { t } = useT();
  if (state.status === "loading") {
    return (
      <SettingsSection title={title} testID={testID}>
        <SettingsCard>
          <SettingsRow label={t("settings.loading")} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (state.status === "ready") return null;
  return (
    <SettingsSection title={title} testID={testID}>
      <SettingsCard>
        <SettingsRow label={state.status === "invalid" ? t("settings.invalid") : t("settings.loadFailed")} error={state.error} />
        <SettingsAction label={t("settings.reloadLabel")} actionLabel={t("settings.reload")} onPress={() => void state.reload()} testID={`${testID}-reload`} />
        {state.status === "invalid" && <SettingsAction label={t("settings.resetLabel")} actionLabel={t("settings.reset")} onPress={() => void state.reset()} testID={`${testID}-reset`} />}
      </SettingsCard>
    </SettingsSection>
  );
}

// --- safety ---------------------------------------------------------------------------------------------------------

function SafetySection() {
  const { t } = useT();
  const settings = useSettings(safetySettings);
  if (settings.status !== "ready") return <NotReady state={settings} title={t("settings.safety.title")} testID="ag-settings-safety" />;
  return <SafetyControls settings={settings} />;
}

/** Protected-branch patterns as typed: commas or new lines between them. */
export function parsePatterns(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,\n]/)
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern !== ""),
    ),
  ];
}

function SafetyControls({ settings }: { settings: Loaded<SafetyPolicy> }) {
  const th = useTheme();
  const { t, tx } = useT();
  const values = settings.values;
  // The draft keeps the revision it was started from, so that another client's save in between is a conflict.
  const [draft, setDraft] = useState<{ text: string; revision: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const patterns = draft === null ? values.protectedBranches : parsePatterns(draft.text);
  const tooMany = patterns.length > PROTECTED_BRANCHES_MAX;
  const change = <Key extends keyof SafetyPolicy>(key: Key, value: SafetyPolicy[Key]) => {
    setSaved(false);
    void settings.save({ ...values, [key]: value }, settings.revision);
  };
  const savePatterns = async () => {
    if (draft === null || tooMany) return;
    const ok = await settings.save({ ...values, protectedBranches: parsePatterns(draft.text) }, draft.revision);
    if (ok) {
      setDraft(null);
      setSaved(true);
    }
  };
  return (
    <SettingsSection title={t("settings.safety.title")} info={t("settings.safety.info")} testID="ag-settings-safety">
      <SettingsCard>
        {SAFETY_SWITCHES.map((name: SafetySwitch) => (
          <SettingsSwitch
            key={name}
            label={tx(`settings.safety.${name}.label`)}
            hint={tx(`settings.safety.${name}.hint`)}
            error={values[name] ? tx(`settings.safety.${name}.warning`) : null}
            value={values[name]}
            disabled={settings.saving}
            onValueChange={(on) => change(name, on)}
            testID={`ag-setting-${name}`}
          />
        ))}
        <SettingsSwitch
          label={t("settings.safety.safetySnapshots.label")}
          hint={t("settings.safety.safetySnapshots.hint")}
          value={values.safetySnapshots}
          disabled={settings.saving}
          onValueChange={(on) => change("safetySnapshots", on)}
          testID="ag-setting-safetySnapshots"
        />
      </SettingsCard>
      <SettingsCard>
        <SettingsInput
          label={t("settings.safety.protectedBranches.label")}
          hint={t("settings.safety.protectedBranches.hint")}
          error={tooMany ? t("settings.safety.protectedBranches.tooMany", { count: PROTECTED_BRANCHES_MAX }) : null}
          initialValue={values.protectedBranches.join(", ")}
          placeholder={t("settings.safety.protectedBranches.placeholder")}
          disabled={settings.saving}
          onChangeText={(text) => {
            setSaved(false);
            setDraft((current) => ({ text, revision: current?.revision ?? settings.revision }));
          }}
          testID="ag-setting-protectedBranches"
        />
        <SettingsAction
          label={saved ? t("settings.safety.protectedBranches.saved") : t("settings.safety.protectedBranches.saveLabel")}
          actionLabel={t("settings.safety.protectedBranches.save")}
          disabled={settings.saving || draft === null || tooMany}
          onPress={() => void savePatterns()}
          testID="ag-setting-protectedBranches-save"
        />
      </SettingsCard>
      {settings.saveError !== null && (
        <View style={{ paddingTop: th.space.sm }}>
          <T tone="danger" accessibilityRole="alert">
            {t("settings.saveFailed")}
          </T>
          <T tone="muted" size={th.small} selectable>
            {settings.saveError}
          </T>
        </View>
      )}
    </SettingsSection>
  );
}

// --- view -----------------------------------------------------------------------------------------------------------

function ViewSection() {
  const { t } = useT();
  const settings = useSettings(viewSettings);
  if (settings.status !== "ready") return <NotReady state={settings} title={t("settings.view.title")} testID="ag-settings-view" />;
  return <ViewControls settings={settings} />;
}

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24] as const;
const FETCH_MINUTES = [1, 2, 3, 5, 10, 15, 30, 60, 120] as const;

function ViewControls({ settings }: { settings: Loaded<ViewPreferences> }) {
  const th = useTheme();
  const { t } = useT();
  const values = settings.values;
  const change = <Key extends keyof ViewPreferences>(key: Key, value: ViewPreferences[Key]) => void settings.save({ ...values, [key]: value }, settings.revision);
  const disabled = settings.saving;
  // A select's options are strings; numbers are kept as their digits. A stored size outside the list is offered too.
  const fontSizes: number[] = FONT_SIZES.includes(values.codeFontSize as (typeof FONT_SIZES)[number]) ? [...FONT_SIZES] : [...FONT_SIZES, values.codeFontSize].sort((a, b) => a - b);
  const minutes: number[] = FETCH_MINUTES.includes(values.autoFetchMinutes as (typeof FETCH_MINUTES)[number]) ? [...FETCH_MINUTES] : [...FETCH_MINUTES, values.autoFetchMinutes].sort((a, b) => a - b);
  return (
    <SettingsSection title={t("settings.view.title")} info={t("settings.view.info")} testID="ag-settings-view">
      <SettingsCard>
        <SettingsSelect
          label={t("settings.view.diffMode.label")}
          hint={t("settings.view.diffMode.hint")}
          value={values.diffMode}
          options={[
            { value: "split", label: t("settings.view.diffMode.split") },
            { value: "unified", label: t("settings.view.diffMode.unified") },
          ]}
          disabled={disabled}
          onValueChange={(mode) => change("diffMode", mode)}
          testID="ag-setting-diffMode"
        />
        <SettingsSwitch
          label={t("settings.view.diffWrap.label")}
          hint={t("settings.view.diffWrap.hint")}
          value={values.diffWrap}
          disabled={disabled}
          onValueChange={(on) => change("diffWrap", on)}
          testID="ag-setting-diffWrap"
        />
        <SettingsSwitch
          label={t("settings.view.diffHideUnchanged.label")}
          hint={t("settings.view.diffHideUnchanged.hint")}
          value={values.diffHideUnchanged}
          disabled={disabled}
          onValueChange={(on) => change("diffHideUnchanged", on)}
          testID="ag-setting-diffHideUnchanged"
        />
        <SettingsSelect
          label={t("settings.view.diffWhitespace.label")}
          hint={t("settings.view.diffWhitespace.hint")}
          value={values.diffWhitespace}
          options={[
            { value: "ignore-trim", label: t("settings.view.diffWhitespace.ignoreTrim") },
            { value: "show", label: t("settings.view.diffWhitespace.show") },
          ]}
          disabled={disabled}
          onValueChange={(mode) => change("diffWhitespace", mode)}
          testID="ag-setting-diffWhitespace"
        />
        <SettingsSwitch
          label={t("settings.view.syntaxHighlight.label")}
          hint={t("settings.view.syntaxHighlight.hint")}
          value={values.syntaxHighlight}
          disabled={disabled}
          onValueChange={(on) => change("syntaxHighlight", on)}
          testID="ag-setting-syntaxHighlight"
        />
        <SettingsSelect
          label={t("settings.view.codeFontSize.label")}
          hint={t("settings.view.codeFontSize.hint")}
          value={String(values.codeFontSize)}
          options={fontSizes.map((size) => ({ value: String(size), label: t("settings.view.codeFontSize.value", { size }) }))}
          disabled={disabled}
          onValueChange={(size) => change("codeFontSize", Number(size))}
          testID="ag-setting-codeFontSize"
        />
      </SettingsCard>
      <SettingsCard>
        <SettingsSelect
          label={t("settings.view.graphScope.label")}
          hint={t("settings.view.graphScope.hint")}
          value={values.graphScope}
          options={[
            { value: "all", label: t("settings.view.graphScope.all") },
            { value: "current", label: t("settings.view.graphScope.current") },
          ]}
          disabled={disabled}
          onValueChange={(scope) => change("graphScope", scope)}
          testID="ag-setting-graphScope"
        />
        <SettingsSelect
          label={t("settings.view.dateStyle.label")}
          hint={t("settings.view.dateStyle.hint")}
          value={values.dateStyle}
          options={[
            { value: "relative", label: t("settings.view.dateStyle.relative") },
            { value: "absolute", label: t("settings.view.dateStyle.absolute") },
          ]}
          disabled={disabled}
          onValueChange={(style) => change("dateStyle", style)}
          testID="ag-setting-dateStyle"
        />
        <SettingsSwitch
          label={t("settings.view.autoFetch.label")}
          hint={t("settings.view.autoFetch.hint")}
          value={values.autoFetch}
          disabled={disabled}
          onValueChange={(on) => change("autoFetch", on)}
          testID="ag-setting-autoFetch"
        />
        <SettingsSelect
          label={t("settings.view.autoFetchMinutes.label")}
          hint={t("settings.view.autoFetchMinutes.hint")}
          value={String(values.autoFetchMinutes)}
          options={minutes.map((count) => ({ value: String(count), label: t("settings.view.autoFetchMinutes.value", { count }) }))}
          disabled={disabled || !values.autoFetch}
          onValueChange={(count) => change("autoFetchMinutes", Number(count))}
          testID="ag-setting-autoFetchMinutes"
        />
        <SettingsSwitch
          label={t("settings.view.confirmDiscard.label")}
          hint={t("settings.view.confirmDiscard.hint")}
          value={values.confirmDiscard}
          disabled={disabled}
          onValueChange={(on) => change("confirmDiscard", on)}
          testID="ag-setting-confirmDiscard"
        />
      </SettingsCard>
      {settings.saveError !== null && (
        <View style={{ paddingTop: th.space.sm }}>
          <T tone="danger" accessibilityRole="alert">
            {t("settings.saveFailed")}
          </T>
          <T tone="muted" size={th.small} selectable>
            {settings.saveError}
          </T>
        </View>
      )}
    </SettingsSection>
  );
}
