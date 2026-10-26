import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AppConfig } from '@vop/config';
import { Inject } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../authz/public.decorator';
import { CurrentUser, type AuthUser } from './auth-user';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { OidcService, type ClaimMapping } from './oidc.service';
import { SamlService } from './saml.service';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) }).strict();
type LoginBody = z.infer<typeof loginSchema>;

const OIDC_STATE_COOKIE = 'vop_oidc';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly oidc: OidcService,
    private readonly saml: SamlService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Local break-glass login (disabled unless enabled by config)' })
  async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(loginSchema)) body: LoginBody,
  ): Promise<{ userId: string; mustChangePassword: boolean }> {
    const result = await this.auth.localLogin(
      body.email,
      body.password,
      req.ip,
      req.headers['user-agent'],
    );
    this.sessions.setCookie(res, result.token);
    return { userId: result.userId, mustChangePassword: result.mustChangePassword };
  }

  @Post('logout')
  @ApiOperation({ summary: 'Log out and revoke the current session' })
  async logout(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(user.sessionId, user.id);
    this.sessions.clearCookie(res);
    return { ok: true };
  }

  @Get('me')
  @ApiOperation({ summary: 'The current authenticated user' })
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      roles: user.roles,
      permissions: [...user.permissions],
      // ADR-0008: the company this request works in, and every company the user may switch to.
      activeEntity: user.entities.find((e) => e.id === user.entityId) ?? null,
      entities: user.entities,
      groupWide: user.groupWide,
    };
  }

  // ---- OIDC (Authorization Code + PKCE) ----

  @Public()
  @Get('oidc/start')
  @ApiOperation({ summary: 'Begin OIDC login (redirects to the IdP)' })
  async oidcStart(@Res() res: Response): Promise<void> {
    const authReq = await this.oidc.createAuthRequest();
    res.cookie(
      OIDC_STATE_COOKIE,
      JSON.stringify({
        state: authReq.state,
        nonce: authReq.nonce,
        codeVerifier: authReq.codeVerifier,
      }),
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.session.cookieSecure,
        maxAge: 600_000,
      },
    );
    res.redirect(authReq.url);
  }

  @Public()
  @Get('oidc/callback')
  @ApiOperation({ summary: 'OIDC redirect callback' })
  async oidcCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const stateCookie = cookies[OIDC_STATE_COOKIE];
    if (!stateCookie) {
      res.redirect(`${this.config.api.publicUrl}/sign-in?error=state`);
      return;
    }
    res.clearCookie(OIDC_STATE_COOKIE);
    const checks = JSON.parse(stateCookie) as {
      state: string;
      nonce: string;
      codeVerifier: string;
    };

    const idp = await this.prisma.idpConfig.findFirst({
      where: { protocol: 'OIDC', enabled: true },
    });
    const mapping = (idp?.claimMappings as ClaimMapping) ?? {};

    const claims = await this.oidc.handleCallback(
      req.query as Record<string, string>,
      checks,
      mapping,
    );
    const result = await this.auth.completeSso(
      claims,
      'OIDC',
      idp?.id ?? '',
      req.ip,
      req.headers['user-agent'],
    );

    if (result.status === 'active') {
      this.sessions.setCookie(res, result.token);
      res.redirect(`${this.config.api.publicUrl}/dashboard`);
    } else {
      res.redirect(`${this.config.api.publicUrl}/pending`);
    }
  }

  // ---- SAML 2.0 ----

  @Public()
  @Get('saml/login')
  @ApiOperation({ summary: 'Begin SAML login (redirects to the IdP)' })
  async samlLogin(@Res() res: Response): Promise<void> {
    const url = await this.saml.getAuthorizeUrl(`${this.config.api.publicUrl}/dashboard`);
    res.redirect(url);
  }

  @Public()
  @Post('saml/callback')
  @ApiOperation({ summary: 'SAML assertion consumer service (ACS)' })
  async samlCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    const idp = await this.prisma.idpConfig.findFirst({
      where: { protocol: 'SAML', enabled: true },
    });
    const claims = await this.saml.consumeResponse(req.body as Record<string, string>);
    const result = await this.auth.completeSso(
      claims,
      'SAML',
      idp?.id ?? '',
      req.ip,
      req.headers['user-agent'],
    );
    if (result.status === 'active') {
      this.sessions.setCookie(res, result.token);
      res.redirect(`${this.config.api.publicUrl}/dashboard`);
    } else {
      res.redirect(`${this.config.api.publicUrl}/pending`);
    }
  }
}
