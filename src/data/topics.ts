export interface Topic {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  postSlugs: string[];
}

export const TOPICS: Topic[] = [
  {
    slug: 'ai-agent-engineering',
    name: 'AI Agent 规范驱动编程实践',
    subtitle: 'AI Agent & Spec-Driven Engineering',
    description: '探讨大模型时代工业级 AI 辅助研发交付体系：告别凭感觉编程（Vibe Coding），推行双轨 SDD 规范意图约束、TDD 机器裁判、Code Review 质量门禁与多 Agent 并发隔离。',
    postSlugs: [
      'agent-programming-sdd-tdd',
      'agent-programming-language-benchmark',
      'ai-coding-era-engineer-survival',
      'ai-code-review-delivery-pipeline',
      'claude-code-multi-agent-worktree',
      'spring-cloud-gateway-webmvc-sse-stream-abort-rca',
    ],
  },
  {
    slug: 'distributed-framework',
    name: '分布式框架内核与微服务治理',
    subtitle: 'Distributed Framework & Governance',
    description: '从零剖析高性能 RPC 框架内核，实现 SPI 微内核机制、微服务治理闭环（熔断、限流、降级、背压）、手写 Seata AT 分布式事务，以及基于 jOOQ 的类型安全空间数据计算。',
    postSlugs: [
      'small-rpc-intro',
      'small-rpc-v3-governance',
      'maven-central-publish-guide',
      'simple-seata-at-mode',
      'jooq-postgis-intro',
    ],
  },
  {
    slug: 'production-rca-troubleshooting',
    name: '生产级深度复盘与根因分析 (RCA)',
    subtitle: 'Production RCA & System Diagnostics',
    description: '真实复杂线上生产环境的第一视角根因分析（RCA）：16G 堆 OOM 与 JVM 性能治理、Spring 生命周期调度冲突、HTTP RFC 规范与真实 Host 丢失、以及 LLM 流式输出中断定位。',
    postSlugs: [
      'refreshscope-scheduled-duplicate-rca',
      'geoserver-16g-oom-postmortem',
      'spring-cloud-gateway-forwarded-host-lost-rca',
      'spring-cloud-gateway-webmvc-sse-stream-abort-rca',
    ],
  },
  {
    slug: 'open-source-contributions',
    name: '开源社区贡献与底层源码剖析',
    subtitle: 'Open Source Contributions & Internals',
    description: '面向主流开源项目（OpenObserve、DolphinScheduler、glogcenter 等）的 PR 贡献复盘，深入并发安全、算法边界与 Goroutine 资源泄漏排查。',
    postSlugs: [
      'openobserve-three-prs',
      'glogcenter-two-prs',
      'simple-seata-at-mode',
    ],
  },
  {
    slug: 'developer-productivity',
    name: '开发者工作流与工程效能体系',
    subtitle: 'Engineering Productivity & Tooling',
    description: '现代工程师的生产力底座：以基础设施即代码（IaC）理念实现终端环境自愈自动化、多运行时协同（mise）、XDG 目录规范与并发交付流水线。',
    postSlugs: [
      'macos-terminal-iterm2-ohmyzsh-evolution',
      'claude-code-multi-agent-worktree',
    ],
  },
];
