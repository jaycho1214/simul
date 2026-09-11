import { useQuery } from "@tanstack/react-query";
import { ipc } from "../ipc/manager.ts";
import type { UpdateState } from "../updates/update-state.ts";

/**
 * Polled, like the server status: the state changes a handful of times an
 * hour at most, and this keeps the preload surface to the one oRPC bridge.
 */
export function useUpdateState(): UpdateState | undefined {
  return useQuery({
    queryKey: ["updateState"],
    queryFn: () => ipc.client.updates.state(),
    refetchInterval: 5000,
  }).data;
}
