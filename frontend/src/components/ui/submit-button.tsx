"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "./button";

/** Bouton d'envoi d'un formulaire de Server Component : il se désactive tout seul pendant l'envoi. */
export function SubmitButton(props: Omit<ComponentProps<typeof Button>, "pending" | "type">) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" pending={pending} />;
}
