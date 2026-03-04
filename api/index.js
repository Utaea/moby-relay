export const config = {
  runtime: 'edge',
};

const DOCKER_HUB_REGISTRY = 'https://registry-1.docker.io';
const DOCKER_HUB_AUTH = 'https://auth.docker.io';

export default async function handler(req) {
  const url = new URL(req.url);
  const { pathname, search } = url;

  // 清理掉原有的 host 请求头，防止上游服务器报错
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('x-forwarded-host');

  // 1. 处理 Docker 的鉴权 Token 请求
  if (pathname === '/token') {
    const targetUrl = new URL(DOCKER_HUB_AUTH + pathname + search);
    const res = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
    });
    return res;
  }

  // 2. 处理 Registry 的核心 API 请求
  const targetUrl = new URL(DOCKER_HUB_REGISTRY + pathname + search);
  const res = await fetch(targetUrl, {
    method: req.method,
    headers: headers,
    redirect: 'manual', // 必须手动处理重定向，否则无法代理镜像层下载
  });

  const resHeaders = new Headers(res.headers);

  // 3. 拦截 401 未授权响应，将鉴权地址修改为我们自己的 Vercel 域名
  if (res.status === 401) {
    const authHeader = resHeaders.get('www-authenticate');
    if (authHeader) {
      const newAuthHeader = authHeader.replace(
        'https://auth.docker.io/token',
        `${url.origin}/token`
      );
      resHeaders.set('www-authenticate', newAuthHeader);
    }
  }

  // 4. 拦截 307 重定向（拉取具体的镜像 blob 层时）
  // 如果不拦截，Docker 客户端会直接去连 Docker 官方的 CDN（通常会被墙）
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = resHeaders.get('location');
    if (location) {
      // 由 Vercel 代理拉取大文件并以流的形式返回给客户端
      const blobRes = await fetch(location, {
        method: req.method,
        headers: headers,
      });
      return blobRes;
    }
  }

  // 正常返回数据
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
}
