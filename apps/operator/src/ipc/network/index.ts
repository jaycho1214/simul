import { networkInterfaces } from "node:os";
import { os } from "@orpc/server";
import { z } from "zod";
import { pickLanAddresses, type LanAddress } from "../../net/lan-ip.ts";
import { evaluateReachability, type ReachabilityCheck } from "../../net/reachability.ts";
import { runWindowsReachabilityProbe } from "../../net/reachability-windows.ts";

export const lanAddresses = os.handler((): LanAddress[] => pickLanAddresses(networkInterfaces()));

export const reachability = os
  .input(z.object({ port: z.number(), externalListenerSeen: z.boolean() }))
  .handler(async ({ input }): Promise<ReachabilityCheck[]> => {
    const probe = await runWindowsReachabilityProbe(input.port);
    return evaluateReachability({
      platform: process.platform,
      port: input.port,
      probe,
      externalListenerSeen: input.externalListenerSeen,
    });
  });
