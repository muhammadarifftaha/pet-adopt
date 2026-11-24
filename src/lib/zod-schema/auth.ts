import z from "zod";

export const loginSchema = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginSchemaType = z.infer<typeof loginSchema>;

export const resetRequestSchema = z.object({
  email: z.email("Invalid email address"),
});

export type ResetRequestSchemaType = z.infer<typeof resetRequestSchema>;

/** The minimum comes from the server (`MIN_PASSWORD_LENGTH`), which stays the authority. */
export const newPasswordSchema = (minLength: number) =>
  z
    .object({
      password: z
        .string()
        .min(minLength, `Use at least ${minLength} characters`)
        .max(128, "Use at most 128 characters"),
      confirm: z.string(),
    })
    .refine((v) => v.password === v.confirm, {
      path: ["confirm"],
      message: "The passwords do not match",
    });

export type NewPasswordSchemaType = z.infer<ReturnType<typeof newPasswordSchema>>;
