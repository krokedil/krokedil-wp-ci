/**
 * E2E metadata types
 * ---------------------------------------------------------------------------
 * Purpose:
 *   Shared typings for plugin-meta-driven e2e assertions.
 */

export type MetaE2EAssertion = {
  selector: string;
  text?: string;
  match?: "contains" | "equals";
};

export type MetaE2EPage = {
  url: string;
  assertions?: MetaE2EAssertion[];
};
