import { useEffect, useMemo, useSyncExternalStore } from "react";
import { AdminClient, adminUrl, type AdminSnapshot } from "../admin/admin-client.ts";
import type { SocketLike } from "../net/reconnecting-socket.ts";

export function useAdmin(port: number): AdminSnapshot {
  const client = useMemo(
    () =>
      new AdminClient({
        url: adminUrl(port),
        factory: (url) => new WebSocket(url) as unknown as SocketLike,
      }),
    [port],
  );

  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);

  return useSyncExternalStore(
    (fn) => client.subscribe(fn),
    () => client.getSnapshot(),
    () => client.getSnapshot(),
  );
}
