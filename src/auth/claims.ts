import type { Identity } from "./auth.js"

export type Claims = Record<string, unknown>

/** Claims offered by "Insert from token" in the parameter fields, in menu order, when the token has them */
export const insertableClaims = ["sub", "email", "preferred_username", "username", "name", "client_id"]

function decodePart(part: string): Claims {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes)) as Claims
}

/** Decodes header and payload of a JWT. Returns undefined for opaque (reference) tokens */
export function decodeJwt(token: string) {
  const parts = token.split(".")
  if (parts.length !== 3)
    return undefined
  try {
    return { header: decodePart(parts[0]), payload: decodePart(parts[1]) }
  } catch {
    return undefined
  }
}

/**
 * The insertable claims of the identity's access token, as text. For a user, claims the access
 * token lacks (often email) are taken from the id token
 */
export function insertableValues(identity: Identity | null | undefined): [name: string, value: string][] {
  if (!identity)
    return []
  const claims: Claims = {
    ...(identity.flow === "authorizationCode" ? identity.user.profile : {}),
    ...decodeJwt(identity.accessToken)?.payload,
  }
  return insertableClaims.flatMap((name) => {
    const value = claims[name]
    return typeof value === "string" || typeof value === "number" ? [[name, String(value)] as [string, string]] : []
  })
}

/** Why insertableValues is empty, shown in place of the claims */
export function noInsertableReason(identity: Identity | null | undefined) {
  if (!identity)
    return "Log in to insert values from the token"
  if (!decodeJwt(identity.accessToken))
    return "The access token is not a JWT"
  return `The token has none of ${insertableClaims.join(", ")}`
}
