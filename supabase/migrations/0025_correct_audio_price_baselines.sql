begin;

-- 2026-08-13 official pricing verification:
-- qwen3-asr-flash-realtime International/Singapore: USD 0.000090/audio second.
-- Cartesia does not publish a standalone PAYG USD/second rate. The active
-- baseline below is only a plan-allocation estimate and must be replaced when
-- contracted billing or credit purchase data is available.

do $$
begin
  if not exists (
    select 1 from public.ai_model_prices
    where provider = 'alibaba'
      and model = 'qwen3-asr-flash-realtime'
      and audio_second_price = 0.000090
      and is_active = true
  ) then
    insert into public.ai_model_prices (
      provider, model, currency, audio_second_price,
      effective_from, notes
    ) values (
      'alibaba', 'qwen3-asr-flash-realtime', 'USD', 0.000090,
      '2026-08-13T00:00:00Z',
      'Alibaba Model Studio international/Singapore realtime ASR input audio price, USD per audio second; transcription output is free. Official: https://www.alibabacloud.com/help/en/model-studio/model-pricing (updated 2026-07-15).'
    );
  end if;

  update public.ai_model_prices
  set is_active = false,
      updated_at = now(),
      notes = 'Superseded: Cartesia pricing page does not publish a standalone PAYG USD/audio-second rate. Historical usage keeps its original price snapshot.'
  where provider = 'cartesia'
    and model = 'sonic-3.5'
    and audio_second_price = 0.00075
    and is_active = true;

  if not exists (
    select 1 from public.ai_model_prices
    where provider = 'cartesia'
      and model = 'sonic-3.5'
      and audio_second_price = 0.00062657
      and is_active = true
  ) then
    insert into public.ai_model_prices (
      provider, model, currency, audio_second_price,
      effective_from, notes
    ) values (
      'cartesia', 'sonic-3.5', 'USD', 0.00062657,
      '2026-08-13T00:00:00Z',
      'Internal plan-allocation estimate only, not an official Cartesia PAYG rate: USD 5 Pro plan divided by approximately 133 included minutes. Official pricing page: https://www.cartesia.ai/pricing. Replace with contracted billing or credit purchase data.'
    );
  end if;
end;
$$;

commit;
