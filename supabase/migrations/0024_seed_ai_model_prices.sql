begin;

-- Price baselines verified from the providers' official pricing pages on 2026-08-13.
-- Keep these as explicit snapshots: changing provider prices should create a new
-- row rather than mutating an existing row used by historical usage events.
do $$
begin
  if not exists (
    select 1 from public.ai_model_prices
    where provider = 'alibaba'
      and model = 'qwen3.7-plus'
      and input_token_price_per_million = 0.276
      and output_token_price_per_million = 1.101
      and is_active = true
  ) then
    insert into public.ai_model_prices (
      provider, model, currency,
      input_token_price_per_million, output_token_price_per_million,
      effective_from, notes
    ) values (
      'alibaba', 'qwen3.7-plus', 'USD',
      0.276, 1.101,
      '2026-08-13T00:00:00Z',
      'Alibaba Model Studio global deployment, <=256K input tokens/request. Official: https://www.alibabacloud.com/help/en/model-studio/model-pricing (updated 2026-07-15). The configured endpoint is not a US-only deployment.'
    );
  end if;

  if not exists (
    select 1 from public.ai_model_prices
    where provider = 'alibaba'
      and model = 'qwen3-asr-flash'
      and audio_second_price = 0.000035
      and is_active = true
  ) then
    insert into public.ai_model_prices (
      provider, model, currency, audio_second_price,
      effective_from, notes
    ) values (
      'alibaba', 'qwen3-asr-flash', 'USD', 0.000035,
      '2026-08-13T00:00:00Z',
      'Alibaba Model Studio international/global ASR input audio price, USD per audio second; transcription output is listed as free. Official: https://www.alibabacloud.com/help/en/model-studio/model-pricing.'
    );
  end if;

  if not exists (
    select 1 from public.ai_model_prices
    where provider = 'cartesia'
      and model = 'sonic-3.5'
      and audio_second_price = 0.00075
      and is_active = true
  ) then
    insert into public.ai_model_prices (
      provider, model, currency, audio_second_price,
      effective_from, notes
    ) values (
      'cartesia', 'sonic-3.5', 'USD', 0.00075,
      '2026-08-13T00:00:00Z',
      'Estimated plan-equivalent baseline, not a published PAYG rate: official pricing lists 15 credits/second for Sonic-3.5 and Pro at USD 5 per 100,000 credits, equivalent to USD 0.00075/audio second. Official: https://www.cartesia.ai/pricing. Replace with contracted billing data when available.'
    );
  end if;
end;
$$;

commit;
