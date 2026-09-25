/**
 * Class merging, in its own module so the primitives and the table can both
 * reach it without importing each other — `index` re-exports `DataTable`, and a
 * cycle through it works right up until a bundler decides it does not.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
