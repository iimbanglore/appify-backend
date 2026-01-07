import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CodemagicWebhookPayload {
  buildId: string;
  appId: string;
  workflowId: string;
  branch: string;
  status: 'building' | 'finished' | 'failed' | 'canceled' | 'queued';
  finishedAt?: string;
  startedAt?: string;
  artefacts?: Array<{
    name: string;
    url: string;
    type: string;
  }>;
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: CodemagicWebhookPayload = await req.json();
    console.log('Received Codemagic webhook:', JSON.stringify(payload, null, 2));

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let status = payload.status;
    if (status === 'finished') {
      status = 'completed' as any;
    }

    const platform = payload.workflowId?.includes('android') ? 'android' : 'ios';

    let downloadUrl: string | null = null;
    if (payload.artefacts && payload.artefacts.length > 0) {
      const artifact = payload.artefacts.find(a => 
        a.type === 'apk' || a.type === 'ipa' || 
        a.name?.endsWith('.apk') || a.name?.endsWith('.ipa')
      ) || payload.artefacts[0];
      downloadUrl = artifact?.url || null;
    }

    const { data: existingBuild } = await supabase
      .from('builds')
      .select('id')
      .eq('build_id', payload.buildId)
      .maybeSingle();

    if (existingBuild) {
      const { error: updateError } = await supabase
        .from('builds')
        .update({
          status,
          download_url: downloadUrl,
          artifact_url: downloadUrl,
          error_message: payload.error || null,
          started_at: payload.startedAt || null,
          finished_at: payload.finishedAt || null,
        })
        .eq('build_id', payload.buildId);

      if (updateError) {
        console.error('Error updating build:', updateError);
        throw updateError;
      }
    } else {
      const { error: insertError } = await supabase
        .from('builds')
        .insert({
          build_id: payload.buildId,
          platform,
          status,
          app_name: 'Unknown App',
          download_url: downloadUrl,
          artifact_url: downloadUrl,
          error_message: payload.error || null,
          started_at: payload.startedAt || null,
          finished_at: payload.finishedAt || null,
        });

      if (insertError) {
        console.error('Error inserting build:', insertError);
        throw insertError;
      }
    }

    console.log(`Successfully processed webhook for build ${payload.buildId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Error processing webhook:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
