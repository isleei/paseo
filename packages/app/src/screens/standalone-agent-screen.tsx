import { useIsFocused } from "@react-navigation/native";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { AgentPanelContent } from "@/panels/agent-panel";
import { useSessionStore } from "@/stores/session-store";

export function StandaloneAgentScreen({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}) {
  const isFocused = useIsFocused();
  const title = useSessionStore((state) => {
    const session = state.sessions[serverId];
    const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
    return agent?.title?.trim() || "Agent session";
  });

  return (
    <View style={styles.container} testID="standalone-agent-screen">
      <MenuHeader title={title} />
      <AgentPanelContent
        serverId={serverId}
        workspaceId={null}
        agentId={agentId}
        isPaneFocused={isFocused}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
