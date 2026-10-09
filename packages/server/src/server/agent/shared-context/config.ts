import { readPaseoConfigForEdit } from "../../../utils/paseo-config-file.js";

export function isSharedContextEnabled(projectRoot: string): boolean {
  const result = readPaseoConfigForEdit(projectRoot);
  return result.ok && result.config?.sharedContext?.enabled === true;
}
