begin;

alter table public.payment_attempts
  drop constraint if exists payment_attempts_channel_check;

alter table public.payment_attempts
  add constraint payment_attempts_channel_check check (
    channel in (
      'wechat_native',
      'wechat_h5',
      'wechat_jsapi',
      'alipay_page',
      'alipay_qr',
      'alipay_wap',
      'manual'
    )
  );

commit;
