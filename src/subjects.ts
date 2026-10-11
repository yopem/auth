import { createSubjects } from "@openauthjs/openauth/subject"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { USER_ROLE, userRole } from "./lib/db/schema"

export const subjects = createSubjects({
  user: Schema.toStandardSchemaV1(
    Schema.Struct({
      id: Schema.String,
      email: Schema.String,
      name: Schema.NullOr(Schema.String),
      username: Schema.String,
      image: Schema.NullOr(Schema.String),
      role: userRole.pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(USER_ROLE[0])),
      ),
    }),
  ),
})
