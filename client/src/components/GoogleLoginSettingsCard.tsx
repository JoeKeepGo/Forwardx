import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { t } from "@/i18n";
import { toast } from "@/lib/localizedToast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { GOOGLE_CALLBACK_PATH, OIDC_CALLBACK_PATH } from "@shared/googleAuth";

export default function GoogleLoginSettingsCard() {
  const utils = trpc.useUtils();
  const { data, isPending, error } = trpc.google.settings.useQuery();
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"google" | "oidc">("google");
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [confirmProviderChange, setConfirmProviderChange] = useState(false);
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled); setProvider(data.provider); setIssuer(data.issuer); setLabel(data.label);
    setClientId(data.clientId); setSecret(""); setConfirmProviderChange(false);
    setRedirectUri(data.redirectUri || `${window.location.origin}${data.provider === "oidc" ? OIDC_CALLBACK_PATH : GOOGLE_CALLBACK_PATH}`);
  }, [data]);
  const save = trpc.google.saveSettings.useMutation({
    onSuccess: async () => { setSecret(""); toast.success(t("SSO 登录配置已保存")); await utils.google.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const changed = !!data && (provider !== data.provider || (provider === "oidc" && issuer.trim() !== data.issuer));
  const busy = isPending || save.isPending;
  const input = { enabled, provider, issuer, label, clientId, clientSecret: secret || undefined, redirectUri, confirmProviderChange };
  return <Card>
    <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <CardTitle className="text-base">{t("SSO 账户登录")}</CardTitle>
        <CardDescription>{t("选择单一身份提供商：Google 或自定义 OIDC（Pocket ID）。密码登录保持可用。")}</CardDescription>
      </div>
      <Badge variant={data?.enabled && data.configured ? "default" : "outline"} className="w-fit shrink-0">{data?.enabled && data.configured ? t("已启用") : t("未启用")}</Badge>
    </CardHeader>
    <CardContent className="space-y-4">
      {error && <p role="alert" className="text-sm text-destructive">{t(error.message)}</p>}
      <div className="space-y-2"><Label htmlFor="sso-provider">{t("身份提供商")}</Label>
        <select id="sso-provider" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={provider} disabled={busy} onChange={event => {
          const value = event.target.value as "google" | "oidc";
          setProvider(value); setSecret(""); setClientId(""); setLabel(value === "oidc" ? "Pocket ID" : "Google"); setConfirmProviderChange(false);
          setRedirectUri(`${window.location.origin}${value === "oidc" ? OIDC_CALLBACK_PATH : GOOGLE_CALLBACK_PATH}`);
        }}><option value="google">Google</option><option value="oidc">OIDC / Pocket ID</option></select>
      </div>
      <div className="flex items-center justify-between gap-4"><Label htmlFor="google-enabled">{t("启用 SSO 登录")}</Label><Switch id="google-enabled" checked={enabled} disabled={busy} onCheckedChange={setEnabled} /></div>
      {provider === "oidc" && <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="oidc-issuer">OIDC Issuer</Label><Input id="oidc-issuer" type="url" value={issuer} onChange={event => { setIssuer(event.target.value); setConfirmProviderChange(false); }} placeholder="https://id.example.com" disabled={busy} />
          <p className="text-xs text-muted-foreground">{t("填写 discovery 中的完整 issuer（不是 discovery URL），包括其尾部斜杠。需要 HTTPS、RS256 和 PKCE S256。")}</p></div>
        <div className="space-y-2"><Label htmlFor="oidc-label">{t("登录按钮名称")}</Label><Input id="oidc-label" value={label} maxLength={40} onChange={event => setLabel(event.target.value)} placeholder="Pocket ID" disabled={busy} /></div>
      </div>}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="google-client-id">Client ID</Label><Input id="google-client-id" autoComplete="off" value={clientId} onChange={event => setClientId(event.target.value)} disabled={busy} /></div>
        <div className="space-y-2"><Label htmlFor="google-client-secret">Client Secret</Label><Input id="google-client-secret" type="password" autoComplete="new-password" value={secret} onChange={event => setSecret(event.target.value)} placeholder={data?.secretConfigured && !changed ? t("密钥已保存，留空保持不变") : "Client Secret"} disabled={busy} /></div>
      </div>
      <div className="space-y-2"><Label htmlFor="google-redirect-uri">{t("授权回调地址")}</Label><Input id="google-redirect-uri" type="url" value={redirectUri} onChange={event => setRedirectUri(event.target.value)} disabled={busy} />
        <p className="text-xs text-muted-foreground">{t("将此完整地址填写到身份提供商的允许回调地址。正式部署使用 HTTPS；请从同一面板域名发起登录。")}</p>
      </div>
      <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
        <p>{t("关闭注册时，新用户须先登录已有账户再绑定。新注册账户仍为普通用户，并遵守邮箱注册白名单、禁用状态和双重验证。不会根据邮箱合并账户。")}</p>
        <p>{t("切换提供商前，每个绑定账户必须先设置并确认密码可用。旧绑定保留；切换后用户通过密码登录、解绑旧身份，再绑定新身份。仅支持浏览器 SSO。")}</p>
      </div>
      {changed && <div className="space-y-2 rounded-md border p-3">
        <p role="alert" className="text-sm">{t("正在切换身份提供商或 Issuer。旧绑定不能用于新提供商登录；仍有无密码账户时服务器会阻止切换。")}</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmProviderChange} disabled={busy} onChange={event => setConfirmProviderChange(event.target.checked)} />{t("我已通知用户迁移，确认密码可用，并理解旧绑定需要手动解绑和重新绑定。")}</label>
      </div>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !!error || (changed && !confirmProviderChange)} onClick={() => save.mutate(input)}>{save.isPending ? t("保存中...") : t("保存 SSO 登录配置")}</Button>
        {data?.secretConfigured && <Button type="button" variant="outline" disabled={busy || changed} onClick={() => {
          if (window.confirm(t("确定清除客户端密钥并关闭 SSO 登录？"))) save.mutate({ ...input, enabled: false, clearSecret: true });
        }}>{t("清除密钥并关闭")}</Button>}
      </div>
    </CardContent>
  </Card>;
}
