// SkillTrack - create logins, reset passwords and send welcome emails (Supabase Edge Function)
// Deploy in Supabase: Edge Functions > Deploy a new function > Via Editor > name it "manage-users" > paste this file.
// Optional secrets for emails (Edge Functions > Secrets): BREVO_API_KEY, SENDER_EMAIL, SENDER_NAME.
// Without them, logins are still created and the admin shares the password themselves.
// Passwords are never stored by SkillTrack: they are shown once to the admin and emailed once.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// 12 characters, easy to read (no 0/O/1/l/I), always with upper, lower and a digit.
function tempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnpqrstuvwxyz", digits = "23456789", all = upper + lower + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 9 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

function emailHtml(kind: "welcome" | "reset", name: string, company: string, url: string, email: string, password: string, logo?: string | null) {
  const intro = kind === "welcome"
    ? `${esc(company)} has set up your SkillTrack account for workplace training.`
    : `Your SkillTrack password for ${esc(company)} has been reset by your administrator.`;
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1d2433">
  ${logo && /^https:\/\//.test(logo) ? `<img src="${esc(logo)}" alt="${esc(company)}" style="max-height:56px;max-width:220px;margin:8px 0">` : ""}
  <h2 style="color:#2f5bea">${kind === "welcome" ? "Welcome to SkillTrack" : "Your new SkillTrack password"}</h2>
  <p>Hi ${esc(name)},</p><p>${intro}</p>
  <table style="border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:6px 12px 6px 0;color:#5d6678">Login page</td><td><a href="${esc(url)}">${esc(url)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#5d6678">Email</td><td><b>${esc(email)}</b></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#5d6678">Temporary password</td><td><b style="font-family:monospace;font-size:16px">${esc(password)}</b></td></tr>
  </table>
  <p>You will be asked to choose your own password when you log in.</p>
  <p><a href="${esc(url)}" style="background:#2f5bea;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Log in to SkillTrack</a></p>
  <p style="color:#5d6678;font-size:13px">If you did not expect this email, please contact your HR team.</p></div>`;
}

async function sendEmail(to: string, name: string, subject: string, html: string): Promise<boolean> {
  const key = Deno.env.get("BREVO_API_KEY"), from = Deno.env.get("SENDER_EMAIL");
  if (!key || !from) return false;
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: from, name: Deno.env.get("SENDER_NAME") || "SkillTrack" }, to: [{ email: to, name }], subject, htmlContent: html }),
  });
  if (!r.ok) console.error("Email failed", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const asCaller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: { user: caller } } = await asCaller.auth.getUser();
  if (!caller) return reply(401, { error: "Please log in again." });

  let body: { action?: string; member_ids?: string[]; app_url?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Invalid request." }); }
  const action = body.action;
  const ids = Array.isArray(body.member_ids) ? [...new Set(body.member_ids.map(String))] : [];
  const appUrl = /^https:\/\/[^\s"<>]+$/.test(body.app_url ?? "") ? body.app_url! : (Deno.env.get("APP_URL") ?? "");
  if (action !== "create_login" && action !== "reset_password") return reply(400, { error: "Unknown action." });
  if (!ids.length || ids.length > 200) return reply(400, { error: "Choose between 1 and 200 employees." });

  const { data: members, error } = await admin.from("members")
    .select("id, email, full_name, company_id, user_id, active, companies(name, slug, logo_url)").in("id", ids);
  if (error) return reply(500, { error: "Could not load employees." });

  // The caller must be HR admin of every company involved (or the Super Admin).
  for (const companyId of new Set((members ?? []).map((m) => m.company_id))) {
    const { data: ok } = await asCaller.rpc("is_admin_of", { p_company: companyId });
    if (!ok) return reply(403, { error: "Only HR admins can manage logins for their own company." });
  }

  const emailConfigured = !!(Deno.env.get("BREVO_API_KEY") && Deno.env.get("SENDER_EMAIL"));
  const results = [];
  for (const m of members ?? []) {
    const co = (m as any).companies ?? {};
    const company = co.name ?? "Your company";
    // Tenant login link: shows this company's logo and name on the login page.
    const loginUrl = appUrl && co.slug ? `${appUrl}?company=${encodeURIComponent(co.slug)}` : appUrl;
    const base = { member_id: m.id, full_name: m.full_name, email: m.email };
    if (!m.active) { results.push({ ...base, error: "Employee is deactivated." }); continue; }
    if (m.user_id === caller.id) { results.push({ ...base, error: "Use your own profile to change your password." }); continue; }
    const password = tempPassword();
    try {
      if (action === "create_login") {
        if (m.user_id) { results.push({ ...base, error: "Already has a login. Use Reset password." }); continue; }
        const { data: created, error: e1 } = await admin.auth.admin.createUser({ email: m.email, password, email_confirm: true, user_metadata: { full_name: m.full_name } });
        if (e1) {
          // Never take over an existing login (it could belong to someone else, e.g. another admin):
          // the person can use "Forgot password" on the login page instead.
          if (/already|registered|exists/i.test(e1.message)) {
            results.push({ ...base, error: "A login already exists for this email. Ask them to use Forgot password on the login page." });
            continue;
          }
          throw e1;
        } else if (created?.user) {
          // The signup trigger links the login; this makes sure even if it did not run.
          await admin.from("members").update({ user_id: created.user.id }).eq("id", m.id).is("user_id", null);
        }
      } else {
        if (!m.user_id) { results.push({ ...base, error: "No login yet. Use Create login." }); continue; }
        const { error: e2 } = await admin.auth.admin.updateUserById(m.user_id, { password });
        if (e2) throw e2;
      }
      await admin.from("members").update({ must_change_password: true }).eq("id", m.id);
      const kind = action === "create_login" ? "welcome" : "reset";
      const emailed = loginUrl ? await sendEmail(m.email, m.full_name,
        kind === "welcome" ? `Welcome to SkillTrack - your login for ${company}` : "Your SkillTrack password has been reset",
        emailHtml(kind, m.full_name, company, loginUrl, m.email, password, co.logo_url)) : false;
      results.push({ ...base, password, emailed, login_url: loginUrl });
    } catch (e) {
      console.error(e);
      results.push({ ...base, error: "Could not update this login. Please try again." });
    }
  }
  return reply(200, { results, email_configured: emailConfigured });
});
