export interface Topic {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  postSlugs: string[];
}

export const TOPICS: Topic[] = [
  {
    slug: 'java-distributed',
    name: 'Java 与分布式系统',
    subtitle: 'Java & Distributed Systems',
    description: '涵盖 Java 后端核心工程体系、Netty 网络编程与分布式架构实战，深入 RPC 微内核、分布式事务 Seata AT 模式、空间计算及线上疑难排查。',
    postSlugs: [
      'credit-risk-cube-calcite-feature-engine',
      'credit-fund-loan-routing-settlement-architecture',
      'credit-risk-engine-multi-kernel-architecture',
      'credit-thirdparty-gateway-architecture',
      'spring-cloud-gateway-webmvc-sse-stream-abort-rca',
      'spring-cloud-gateway-forwarded-host-lost-rca',
      'geoserver-16g-oom-postmortem',
      'refreshscope-scheduled-duplicate-rca',
      'simple-seata-at-mode',
      'small-rpc-v3-governance',
      'small-rpc-intro',
      'maven-central-publish-guide',
      'jooq-postgis-intro',
    ],
  },
  {
    slug: 'rpc-governance',
    name: 'RPC 框架与微服务治理',
    subtitle: 'RPC Microkernel & Governance',
    description: '从零剖析高性能 RPC 框架内核，实现 SPI 微内核机制、Filter 链，手写客户端滑动窗口熔断器、令牌桶限流、降级 Fallback 与背压治理闭环。',
    postSlugs: [
      'small-rpc-v3-governance',
      'small-rpc-intro',
      'maven-central-publish-guide',
      'simple-seata-at-mode',
    ],
  },
  {
    slug: 'ai-agent-engineering',
    name: 'AI Agent 规范驱动编程实践',
    subtitle: 'AI Agent & Spec-Driven Engineering',
    description: '探讨大模型时代工业级 AI 辅助研发交付体系：告别凭感觉编程（Vibe Coding），推行双轨 SDD 规范意图约束、TDD 机器裁判与严谨 Code Review 交付流水线。',
    postSlugs: [
      'black-box-ai-programming-engineering-mindset',
      'claude-code-multi-agent-worktree',
      'ai-code-review-delivery-pipeline',
      'ai-coding-era-engineer-survival',
      'agent-programming-language-benchmark',
      'agent-programming-sdd-tdd',
      'macos-terminal-iterm2-ohmyzsh-evolution',
    ],
  },
  {
    slug: 'troubleshooting-opensource',
    name: '故障排查与开源源码实战',
    subtitle: 'Troubleshooting & Open Source',
    description: '生产级深度技术排查与开源社区贡献复盘：剖析 Spring 复杂生命周期调度重入缺陷、OpenObserve 边界缺陷定位，以及 Glogcenter 协程泄漏排查。',
    postSlugs: [
      'spring-cloud-gateway-webmvc-sse-stream-abort-rca',
      'spring-cloud-gateway-forwarded-host-lost-rca',
      'geoserver-16g-oom-postmortem',
      'refreshscope-scheduled-duplicate-rca',
      'openobserve-three-prs',
      'glogcenter-two-prs',
    ],
  },
  {
    slug: 'gis-spatial',
    name: '遥感 GIS 与空间计算架构',
    subtitle: 'GIS & Spatial Computing',
    description: '深入遥感影像元数据分表、高并发 GIS 瓦片代理网关、PostGIS 空间检索优化与 jOOQ 类型安全空间计算实战。',
    postSlugs: [
      'gis-tile-proxy-gateway-architecture',
      'remote-sensing-metadata-sharding-postgis',
      'geoserver-16g-oom-postmortem',
      'jooq-postgis-intro',
    ],
  },
];
