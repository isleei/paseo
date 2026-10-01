import { z } from "zod";

export const ACPProviderOptionsSchema = z
  .object({
    authMethodId: z.string().min(1).optional(),
    supportsMcpServers: z.boolean().optional(),
    clientCapabilities: z
      .object({
        fs: z
          .object({
            readTextFile: z.boolean().optional(),
            writeTextFile: z.boolean().optional(),
          })
          .optional(),
        terminal: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
