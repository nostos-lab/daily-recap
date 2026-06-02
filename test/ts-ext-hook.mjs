// 테스트 전용 해석 훅: extensionless 상대 import를 .ts로 매핑.
// 프로덕션 빌드(tsc, commonjs)는 extensionless를 그대로 쓰므로 영향 없음.
export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && !/\.(mjs|cjs|js|ts|json)$/.test(specifier)) {
    try {
      return await nextResolve(specifier + ".ts", context);
    } catch {
      // 폴백: 원래 specifier로 재시도
    }
  }
  return nextResolve(specifier, context);
}
