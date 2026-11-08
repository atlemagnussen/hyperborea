import type { OpenAPIV3 } from "openapi-types"
import { resolve, type Document } from "./openapi.js"

/** The OAuth flows this client logs in with, named as in OpenAPI's oauth2 flows */
export type LoginFlow = "authorizationCode" | "clientCredentials"

/** Authorization Code flow with PKCE: interactive user login */
export interface AuthorizationCodeOption {
  /** OIDC authority (issuer) */
  authority: string
  /** Endpoints when the spec has no OIDC discovery url */
  authorizationEndpoint?: string
  tokenEndpoint?: string
  /** Scopes the spec offers, with descriptions */
  scopes: Record<string, string>
  /** Offered scopes the spec's security requirements name, plus openid; selected by default */
  requiredScopes: string[]
}

/** Client Credentials flow: machine login */
export interface ClientCredentialsOption {
  tokenUrl: string
  /** Scopes the spec offers, with descriptions */
  scopes: Record<string, string>
  /** Offered scopes the spec's security requirements name; selected by default */
  requiredScopes: string[]
}

export interface AuthOptions {
  authorizationCode?: AuthorizationCodeOption
  clientCredentials?: ClientCredentialsOption
}

const discoverySuffix = "/.well-known/openid-configuration"

/** Scopes of a scheme in the document's (root) security requirements, which are alternatives */
function requirementScopes(document: Document, scheme: string | undefined) {
  if (!scheme)
    return []
  return (document.security ?? []).flatMap((req) => req[scheme] ?? [])
}


/**
 * Login options declared in the spec's securitySchemes:
 * - oauth2 authorizationCode (PKCE, e.g. x-usePkce) and/or openIdConnect -> Authorization Code
 * - oauth2 clientCredentials -> Client Credentials
 * Both offer only the scopes the scheme's flow defines (strict: a scope named in a security
 * requirement but not defined in the scheme is ignored); the required ones are selected by default.
 */
export function getAuthOptions(document: Document): AuthOptions {
  const options: AuthOptions = {}
  const schemes = Object.entries(document.components?.securitySchemes ?? {}).map(
    ([name, scheme]) => [name, resolve(document, scheme)] as [string, OpenAPIV3.SecuritySchemeObject],
  )

  const oidc = schemes.find(([, s]) => s.type === "openIdConnect") as
    | [string, OpenAPIV3.OpenIdSecurityScheme]
    | undefined
  const code = schemes.find(([, s]) => s.type === "oauth2" && s.flows.authorizationCode) as
    | [string, OpenAPIV3.OAuth2SecurityScheme]
    | undefined
  const client = schemes.find(([, s]) => s.type === "oauth2" && s.flows.clientCredentials) as
    | [string, OpenAPIV3.OAuth2SecurityScheme]
    | undefined

  if (oidc || code) {
    const flow = code?.[1].flows.authorizationCode
    // openid is always offered and required: the login needs it for the id token (who logged in)
    const scopes: Record<string, string> = { openid: "Sign in with OpenID Connect", ...flow?.scopes }
    const required = [
      ...new Set(["openid", ...requirementScopes(document, code?.[0]), ...requirementScopes(document, oidc?.[0])]),
    ].filter((s) => s in scopes)
    const discoveryUrl = oidc?.[1].openIdConnectUrl
    options.authorizationCode = {
      authority: discoveryUrl
        ? discoveryUrl.replace(discoverySuffix, "")
        : new URL(flow!.authorizationUrl).origin,
      // without discovery, give oidc-client-ts the endpoints from the flow
      authorizationEndpoint: discoveryUrl ? undefined : flow?.authorizationUrl,
      tokenEndpoint: discoveryUrl ? undefined : flow?.tokenUrl,
      scopes,
      requiredScopes: required,
    }
  }

  if (client) {
    // with no required scopes nothing is selected: requesting none gives the token all scopes the
    // client is allowed, while requesting one the client lacks fails the whole request
    const flow = client[1].flows.clientCredentials!
    const scopes = flow.scopes ?? {}
    const required = [...new Set(requirementScopes(document, client[0]))].filter((s) => s in scopes)
    options.clientCredentials = { tokenUrl: flow.tokenUrl, scopes, requiredScopes: required }
  }
  return options
}
