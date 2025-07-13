/* eslint-disable no-useless-escape */

import { customAlphabet } from "nanoid"
import { transliterate as tr } from "transliteration"

export const createCustomId = customAlphabet(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  64,
)

export function slugifyUsername(text: string) {
  return tr(text)
    .toString() // Cast to string (optional)
    .normalize("NFKD") // The normalize() using NFKD method returns the Unicode Normalization Form of a given string.
    .replace(/[\u0300-\u036f]/g, "") // remove all previously split accents
    .toLowerCase() // Convert the string to lowercase letters
    .trim() // Remove whitespace from both sides of a string (optional)
    .replace(/\s+/g, "") // Replace spaces with non-space-chars
    .replace(/[^\w\-]+/g, "") // Remove all non-word chars
    .replace(/\-/g, "") // Replace - with non-space-chars
    .replace(/\_/g, "") // Replace _ with non-space-chars
    .replace(/\-\-+/g, "-") // Replace multiple - with single -
    .replace(/\-$/g, "") // Remove trailing -
}
