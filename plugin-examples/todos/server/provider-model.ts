// Combines a provider input ("provider" or "provider/model") with an
// optional explicit model into the "provider/model" selection the daemon
// requires. Same rule as the CLI's resolveProviderAndModel, reimplemented
// here because plugin server code cannot import the CLI package.
export function toProviderModel(provider: string, model?: string): string {
  const trimmedProvider = provider.trim();
  const trimmedModel = model?.trim() || undefined;
  if (!trimmedProvider) throw new Error("Pick a provider and model to dispatch");
  const separator = trimmedProvider.indexOf("/");
  if (separator === -1) {
    if (!trimmedModel) {
      throw new Error(`Pick a model for provider "${trimmedProvider}" (expected "provider/model")`);
    }
    return `${trimmedProvider}/${trimmedModel}`;
  }
  const head = trimmedProvider.slice(0, separator).trim();
  const tail = trimmedProvider.slice(separator + 1).trim();
  if (!head || !tail) throw new Error(`Invalid provider value "${provider}"`);
  if (trimmedModel && trimmedModel !== tail) {
    throw new Error(`Conflicting models "${trimmedModel}" vs "${tail}"`);
  }
  return `${head}/${tail}`;
}

export function defaultProviderFromEnv(): string | undefined {
  return process.env.TODOS_DEFAULT_PROVIDER?.trim() || undefined;
}

export function defaultModelFromEnv(): string | undefined {
  return process.env.TODOS_DEFAULT_MODEL?.trim() || undefined;
}
