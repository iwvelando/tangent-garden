import { isValidElement, type ReactNode } from "react";

// Help a control shows on request, in two tiers (AGENTS.md, Help text): the
// essentials, one short line that opens with the help, and more, for the
// reader who still has a question, behind Show more. Help that needs no
// more than its essentials is given as is.
export type Tiered<T = ReactNode> = { brief: T; more: T };
export type Help<T = ReactNode> = T | Tiered<T>;

export const tiered = <T>(brief: T, more: T): Tiered<T> => ({ brief, more });

export function isTiered<T>(help: Help<T>): help is Tiered<T> {
  return (
    typeof help === "object" &&
    help !== null &&
    !Array.isArray(help) &&
    !isValidElement(help) &&
    "brief" in help &&
    "more" in help
  );
}

// Adds to a help's more, as when one setting extends another's help.
export function withMore(help: Help<string>, more: string): Tiered<string> {
  return isTiered(help)
    ? tiered(help.brief, `${help.more} ${more}`)
    : tiered(help, more);
}

// The whole text of a help, both tiers in order.
export function helpText(help: Help<string>): string {
  return isTiered(help) ? `${help.brief} ${help.more}` : help;
}
