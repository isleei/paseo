import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import {
  ISLAND_MASCOT_SKINS,
  useIslandSettings,
  type IslandMascotSkin,
} from "@/desktop/island/use-island-settings";

const SkinButton = memo(function SkinButton({
  skin,
  selected,
  disabled,
  onSelect,
}: {
  skin: IslandMascotSkin;
  selected: boolean;
  disabled: boolean;
  onSelect: (skin: IslandMascotSkin) => void;
}) {
  const handlePress = useCallback(() => {
    onSelect(skin);
  }, [onSelect, skin]);
  return (
    <Button
      size="sm"
      variant={selected ? "secondary" : "ghost"}
      disabled={disabled}
      onPress={handlePress}
      accessibilityLabel={skin}
    >
      {skin}
    </Button>
  );
});
const styles = StyleSheet.create((theme) => ({
  skinGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
}));

export function DesktopIslandSection() {
  const { t } = useTranslation();
  const { isSupported, isLoading, enabled, mascotSkin, setEnabled, setMascotSkin } =
    useIslandSettings();

  const handleEnabledChange = useCallback(
    (next: boolean) => {
      setEnabled(next);
    },
    [setEnabled],
  );

  const handleSkinPress = useCallback(
    (skin: IslandMascotSkin) => {
      setMascotSkin(skin);
    },
    [setMascotSkin],
  );

  if (!isSupported) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.island.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.island.enabled")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.island.enabledHint")}</Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={handleEnabledChange}
            disabled={isLoading}
            accessibilityLabel={t("settings.island.enabled")}
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.island.dismissHint")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.island.dismissHintDetail")}</Text>
          </View>
        </View>
        <View style={settingsStyles.rowBorder}>
          <View style={[settingsStyles.row, { paddingBottom: 0 }]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.island.mascot")}</Text>
            </View>
          </View>
          <View style={styles.skinGrid}>
            {ISLAND_MASCOT_SKINS.map((skin) => (
              <SkinButton
                key={skin}
                skin={skin}
                selected={skin === mascotSkin}
                disabled={isLoading}
                onSelect={handleSkinPress}
              />
            ))}
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}
