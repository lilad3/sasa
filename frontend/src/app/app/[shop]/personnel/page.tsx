import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ComposeNote } from "@/features/notes/compose";
import { NoteActions, Receipts } from "@/features/notes/note-extras";
import { NoteCard } from "@/features/notes/note-card";
import { AddMemberForm } from "@/features/settings/add-member-form";
import { getPlans } from "@/features/settings/data";
import { MemberRow } from "@/features/settings/member-row";
import { formatNumber } from "@/lib/format";
import { getMe, getMembers, getMyShops, getPresence, getTeamNotes } from "@/lib/server/session";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Mon personnel" };

export default function StaffPage({ params }: PageProps<"/app/[shop]/personnel">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[26px]" />}>
      <StaffFromRoute params={params} />
    </Suspense>
  );
}

/**
 * « Mon personnel » (le propriétaire) ou « L'équipe » (un gérant) : qui est là aujourd'hui, les messages
 * et qui les a vus, et la gestion de l'équipe selon les pouvoirs de chacun. Le vendeur a « Messages ».
 */
async function StaffFromRoute({ params }: Pick<PageProps<"/app/[shop]/personnel">, "params">) {
  const { shop } = await params;
  const [shops, me] = await Promise.all([getMyShops(), getMe()]);
  if (!shops.ok || !me.ok) throw new Error("Impossible de charger votre compte.");
  const membership = shops.data.find((item) => item.slug === shop);
  if (!membership) notFound();
  if (membership.role === "seller") redirect(`/app/${shop}/messages`);

  const can = (permission: string) => membership.permissions.includes(permission);
  const isOwner = membership.role === "owner";
  const canAdd = can("team.manage_sellers");
  const [members, notes, presence, plans] = await Promise.all([
    getMembers(shop),
    getTeamNotes(shop),
    can("team.presence") ? getPresence(shop) : null,
    can("shop.manage") ? getPlans(shop) : null,
  ]);
  if (!members.ok || !notes.ok) throw new Error("Impossible de charger l’équipe.");

  const v = voice(membership.role, membership.name);
  const byUser = new Map(presence?.ok ? presence.data.map((entry) => [entry.user_id, entry]) : []);
  const here = presence?.ok ? presence.data.filter((entry) => entry.status === "today").length : null;
  const handled = presence?.ok ? presence.data.reduce((sum, entry) => sum + entry.handled_today, 0) : null;
  const plan = plans?.ok ? plans.data.plans.find((item) => item.id === plans.data.current) : undefined;
  const full =
    plans?.ok && plan && plan.members !== null && plans.data.usage.members >= plan.members ? { plan: plan.name, limit: plan.members } : null;

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">
            {formatNumber(members.data.length)} personne{members.data.length > 1 ? "s" : ""}
            {isOwner ? ", vous compris" : ` chez ${membership.name}`}
          </p>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,34px)] font-medium tracking-tight">{v.team}</h1>
        </div>
        {here !== null ? (
          <div className="flex flex-wrap gap-2.5" aria-label="Aujourd’hui">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-encre/40 px-3.5 py-1.5 text-[13px]">
              <span aria-hidden className="pastille-en-ligne size-2 rounded-full bg-orange" />
              {here} sur {members.data.length} connecté{here > 1 ? "s" : ""} aujourd’hui
            </span>
            <span className="inline-flex items-center rounded-full border border-white/12 bg-encre/40 px-3.5 py-1.5 text-[13px] text-texte-2">
              {handled} commande{handled && handled > 1 ? "s" : ""} traitée{handled && handled > 1 ? "s" : ""} aujourd’hui
            </span>
          </div>
        ) : null}
      </header>

      <section aria-labelledby="titre-equipe" className="vitre col-span-full flex flex-col gap-3 self-start rounded-[26px] p-[18px] lg:col-span-6">
        <h2 id="titre-equipe" className="text-sm text-texte-2">
          {presence?.ok ? "Qui est là aujourd’hui" : "L’équipe"}
        </h2>
        <ul className="cascade flex flex-col gap-2.5">
          {members.data.map((member) => (
            <MemberRow
              key={member.user_id}
              slug={shop}
              member={member}
              mfaEnabled={me.data.mfa_enabled}
              viewer={{ isOwner, canManageSellers: canAdd }}
              presence={byUser.get(member.user_id)}
            />
          ))}
        </ul>
      </section>

      <div className="col-span-full flex flex-col gap-2.5 self-start md:gap-3 lg:col-span-4 lg:gap-3.5">
        {can("notes.send") ? (
          <div id="ecrire">
            <ComposeNote slug={shop} members={members.data} />
          </div>
        ) : null}
        {canAdd ? <AddMemberForm slug={shop} mfaEnabled={me.data.mfa_enabled} full={full} sellersOnly={!isOwner} className="" /> : null}
      </div>

      <section aria-labelledby="titre-messages" className="col-span-full flex flex-col gap-2.5 md:gap-3">
        <h2 id="titre-messages" className="px-1 text-sm text-texte-2">
          Messages envoyés, et qui les a vus
        </h2>
        {notes.data.length === 0 ? (
          <p className="vitre rounded-[24px] p-6 text-sm text-texte-3">Aucun message pour l’instant. Votre premier message s’affichera en haut des pages de l’équipe.</p>
        ) : (
          <div className="cascade grid gap-2.5 md:gap-3 lg:grid-cols-2">
            {notes.data.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                actions={<NoteActions note={note} slug={shop} canWithdraw={can("notes.send") && (note.author.is_you || isOwner)} />}
                footer={note.receipts ? <Receipts receipts={note.receipts} /> : null}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
