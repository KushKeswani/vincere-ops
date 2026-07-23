"use client";

import { useActionState } from "react";

import { signInAction, type SignInState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input key={state.email} id="email" name="email" type="email" autoComplete="email" defaultValue={state.email} required aria-describedby="email-error" />
        {state.errors?.email && <p id="email-error" className="text-sm text-destructive">{state.errors.email[0]}</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-describedby="password-error" />
        {state.errors?.password && <p id="password-error" className="text-sm text-destructive">{state.errors.password[0]}</p>}
      </div>
      {state.message && <Alert variant="destructive" aria-live="polite"><AlertDescription>{state.message}</AlertDescription></Alert>}
      <Button className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in securely"}</Button>
    </form>
  );
}
