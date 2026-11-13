"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { FormState } from "@/app/actions";

export function Flash({ state }: { state: FormState | null }) {
  if (!state) return null;
  const failures = state.results?.filter((r) => !r.ok) ?? [];
  return (
    <div className="flash" role="status" aria-live="polite">
      <div className="line">
        <span className={`mark ${state.ok ? "ok" : "err"}`}>{state.ok ? "DONE" : "ERROR"}</span>
        <span>{state.message}</span>
      </div>
      {failures.length > 0 && state.ok && (
        <ul>
          {failures.map((f) => (
            <li key={f.input}>
              <code>{f.input}</code> — {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function countTokens(text: string) {
  return new Set(text.split(/[\s,;]+/).filter(Boolean)).size;
}

function CommandSubmit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? `Analysing${count > 1 ? ` ${count}` : ""}…` : "Analyse"}
      </button>
      {pending && <span className="progress" aria-hidden />}
    </>
  );
}

export function AddDevelopers({ action }: { action: (prev: FormState | null, form: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, null);
  const [value, setValue] = useState("");
  useEffect(() => {
    if (state?.ok) setValue("");
  }, [state]);
  return (
    <div>
      <form className="command" action={formAction}>
        <span className="prefix" aria-hidden>
          @
        </span>
        <label className="sr-only" htmlFor="logins">
          GitHub usernames or profile URLs
        </label>
        <input
          id="logins"
          name="logins"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="usernames or profile URLs — e.g. torvalds, github.com/gaearon"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <CommandSubmit count={countTokens(value)} />
      </form>
      <Flash state={state} />
    </div>
  );
}

function SubmitLabel({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? busy : idle}
      </button>
    </>
  );
}

function FormProgress() {
  const { pending } = useFormStatus();
  return pending ? <span className="progress" aria-hidden /> : null;
}

export function CreateTeam({ action }: { action: (prev: FormState | null, form: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div>
      <form className="compose" action={formAction}>
        <div className="col">
          <label className="field">
            <span>Team name</span>
            <input className="input" name="name" required maxLength={80} placeholder="e.g. Northwind Labs" autoComplete="off" />
            <small>Using an existing team&rsquo;s name adds these members to it.</small>
          </label>
          <label className="field">
            <span>Members</span>
            <textarea className="textarea" name="members" placeholder={"one per line or comma-separated\nusername or github.com/username"} spellCheck={false} />
          </label>
        </div>
        <div className="col">
          <label className="field">
            <span>Team lead (optional)</span>
            <input className="input" name="leader" placeholder="username" autoComplete="off" spellCheck={false} />
            <small>Added to the team if not already listed.</small>
          </label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>Weighting</span>
            <div className="segmented">
              <label>
                <input type="radio" name="mode" value="leader" defaultChecked />
                <span>Lead-weighted</span>
              </label>
              <label>
                <input type="radio" name="mode" value="equal" />
                <span>Equal average</span>
              </label>
            </div>
            <small>Lead-weighted gives the lead 1.2× an equal share: 60/40 for two, 40/30/30 for three. A solo team is always 100%.</small>
          </fieldset>
        </div>
        <div className="foot">
          <p>Every member is analysed independently and on their own evidence; the team score only combines the finished results.</p>
          <SubmitLabel idle="Create team" busy="Analysing members…" />
        </div>
        <FormProgress />
      </form>
      <Flash state={state} />
    </div>
  );
}

export function AddMembers({ action }: { action: (prev: FormState | null, form: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div className="panel" style={{ position: "relative", overflow: "hidden" }}>
      <h3>Add members</h3>
      <p>Members can join at any time. Existing scores are unaffected; only the weights are recalculated.</p>
      <form className="inline-form" action={formAction}>
        <label className="sr-only" htmlFor="members">
          Usernames
        </label>
        <input id="members" className="input" name="members" placeholder="username, username" autoComplete="off" spellCheck={false} required />
        <SubmitLabel idle="Add" busy="Analysing…" />
        <FormProgress />
      </form>
      <Flash state={state} />
    </div>
  );
}

export function RenameTeam({ action, name }: { action: (prev: FormState | null, form: FormData) => Promise<FormState>; name: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <div className="panel">
      <h3>Rename</h3>
      <form className="inline-form" action={formAction}>
        <label className="sr-only" htmlFor="team-name">
          Team name
        </label>
        <input id="team-name" className="input" name="name" defaultValue={name} maxLength={80} required />
        <SubmitLabel idle="Save" busy="Saving…" />
      </form>
      <Flash state={state} />
    </div>
  );
}

/** A button that runs a server action, with an optional confirmation step and pending label. */
export function ActionButton({
  action,
  children,
  busy,
  confirm,
  className = "textlink",
}: {
  action: () => Promise<unknown>;
  children: React.ReactNode;
  busy?: string;
  confirm?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setMessage(null);
          start(async () => {
            const result = (await action()) as FormState | undefined;
            if (result && !result.ok) setMessage(result.message);
            router.refresh();
          });
        }}
      >
        {pending ? (busy ?? "Working…") : children}
      </button>
      {message && (
        <span role="alert" className="muted" style={{ fontSize: 12.5, color: "var(--danger)" }}>
          {message}
        </span>
      )}
    </>
  );
}
