// Supabase Edge Function: tar emot Stripes webhooks och uppdaterar public.subscriptions.
//
// Hemligheter (Supabase → Edge Functions → Secrets), läggs in av ägaren:
//   STRIPE_SECRET_KEY       sk_test_… / sk_live_…
//   STRIPE_WEBHOOK_SECRET   whsec_… (från webhook-endpointen i Stripe)
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY finns automatiskt.
//
// Stripe-händelser som ska skickas hit: checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted.
// Stäng av "Verify JWT" för funktionen – Stripe skickar ingen Supabase-token, signaturen kontrolleras i stället.

import Stripe from 'npm:stripe@17.4.0';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2024-11-20.acacia' });
const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
const STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled', 'incomplete']);

async function save(userId: string, sub: Stripe.Subscription) {
  const status = STATUSES.has(sub.status) ? sub.status : 'canceled';
  const end = sub.items?.data?.[0]?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const { error } = await db.from('subscriptions').upsert({
    user_id: userId,
    status,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    stripe_customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription: sub.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

Deno.serve(async req => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Saknar signatur', { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '');
  } catch (err) {
    return new Response(`Ogiltig signatur: ${(err as Error).message}`, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      if (userId && session.subscription) {
        const sub = await stripe.subscriptions.retrieve(String(session.subscription));
        // Spara användar-id på prenumerationen så att senare händelser hittar rätt konto.
        await stripe.subscriptions.update(sub.id, { metadata: { user_id: userId } });
        await save(userId, sub);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      let userId = sub.metadata?.user_id;
      if (!userId) {
        const { data } = await db.from('subscriptions').select('user_id').eq('stripe_subscription', sub.id).maybeSingle();
        userId = data?.user_id;
      }
      if (userId) await save(userId, sub);
    }
  } catch (err) {
    console.error(err);
    return new Response('Fel vid sparning', { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
});
