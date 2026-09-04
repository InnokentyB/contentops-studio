import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { useLocale } from '../i18n/locale'
import './Landing.css'

const content = {
  ru: {
    nav: ['Процесс', 'Продукт', 'Роли', 'Подключение'], login: 'Войти', cta: 'Создать проект', secondaryCta: 'Посмотреть рабочий процесс',
    heroLabel: 'Контентные операции для команд людей и AI',
    heroTitle: 'Планируйте, согласовывайте и публикуйте контент без потери контекста',
    heroText: 'Принятые тексты, утверждённые визуалы, роли и подтверждённые публикации хранятся внутри одного проекта.',
    trust: ['Общий контекст проекта', 'Разделённые полномочия', 'Проверяемый результат'],
    heroAlt: 'Публикационная задача ContentOps Studio с текстом, статусами и действиями',
    heroCaption: ['Реальный экран продукта', 'Задача публикации связывает материал, канал, готовность и результат.'],
    pipelineLabel: 'Один материал, один проверяемый путь', pipelineTitle: 'От решения редактора до факта на площадке',
    pipelineText: 'Каждый handoff оставляет понятный след. Команда видит, что принято, что разрешено к отправке и чем закончилась доставка.',
    pipeline: [['01', 'Принятый текст', 'Редактор фиксирует рабочую редакцию.'], ['02', 'Approved visual', 'К задаче привязан разрешённый asset.'], ['03', 'Единый payload', 'Dry run проверяет то, что уйдёт в live.'], ['04', 'Ответ площадки', 'Адаптер получает object ID или permalink.'], ['05', 'Факт публикации', 'Результат записывается только после подтверждения.']],
    productLabel: 'Вся система в одном проекте', productTitle: 'Не ищите актуальную версию по чатам',
    productText: 'Planner связывает стратегию, производственный план, каналы, задачи и метрики. У каждой сущности есть статус и следующий ответственный.',
    productAlt: 'Обзор проекта ContentOps Studio с каналами, задачами и метриками',
    benefits: [['Контекст не начинается заново', 'Агенты читают один проект, а не пересказывают историю друг другу.'], ['Решения отделены от черновиков', 'Принятая редакция и утверждённый визуал явно зафиксированы.'], ['Результат можно проверить', 'Публикация связана с ответом площадки и внешней ссылкой.']],
    rolesLabel: 'Семь ролей, одна модель проекта', rolesTitle: 'Общий контекст не означает одинаковые права',
    rolesText: 'Каждый агент видит нужную часть процесса и передаёт дальше конкретный результат.',
    roleGroups: [['Решить', [['Стратег', 'Аудитория и позиционирование'], ['Planning HQ', 'Темы, календарь и зависимости']]], ['Подготовить', [['Автор', 'Нативный материал для канала'], ['Главный редактор', 'Решение о приёмке'], ['Арт директор', 'Approved visual']]], ['Доставить и измерить', [['Публикатор', 'Безопасная отправка'], ['Growth аналитик', 'Метрики и гипотезы']]]],
    connectLabel: 'Подключение', connectTitle: 'Начните с проекта, роли подключайте по мере готовности',
    connectText: 'После регистрации вы создаёте проект, подтверждаете доступ агента и выбираете отдельные задачи для стратегии, контента, выпуска и аналитики.',
    steps: [['01', 'Создайте проект', 'Добавьте продукт, каналы и правила работы.'], ['02', 'Подтвердите доступ', 'Авторизация привяжет агента только к выбранному проекту.'], ['03', 'Откройте роли', 'Разделите ответственность между задачами в Codex.']],
    faqTitle: 'Перед стартом',
    faq: [['ContentOps Studio сам генерирует весь контент?', 'Нет. Система организует работу людей и агентов, хранит принятые решения и проводит материал через управляемые этапы.'], ['Можно подключить собственных агентов?', 'Да. Доступ выдаётся на конкретный проект и профиль роли, поэтому рабочий контекст адаптируется под пользователя.'], ['Система может опубликовать без подтверждения?', 'Только роль с нужными полномочиями получает инструменты доставки. Факт фиксируется после ответа внешней площадки.'], ['Все семь задач создаются автоматически?', 'Плагин подключает роли и проектный контекст. Отдельные задачи в Codex пользователь создаёт явно, чтобы сохранить контроль над рабочей областью.']],
    finalTitle: 'Соберите один управляемый контентный процесс', finalText: 'Начните с проекта. Каналы, роли и автоматизацию можно подключать постепенно.',
    footer: 'Контентные операции для команд людей и AI.'
  },
  en: {
    nav: ['Workflow', 'Product', 'Roles', 'Connect'], login: 'Sign in', cta: 'Create project', secondaryCta: 'See the workflow',
    heroLabel: 'Content operations for human and AI teams', heroTitle: 'Plan, approve, and publish content without losing context',
    heroText: 'Accepted copy, approved visuals, role boundaries, and confirmed publications stay inside one project.',
    trust: ['Shared project context', 'Separated authority', 'Verifiable outcomes'],
    heroAlt: 'ContentOps Studio publication task with copy, statuses, and actions',
    heroCaption: ['Real product screen', 'One publication task connects the asset, channel, readiness, and result.'],
    pipelineLabel: 'One asset, one verifiable path', pipelineTitle: 'From editorial decision to channel evidence',
    pipelineText: 'Every handoff leaves a clear trace. The team can see what was accepted, what is eligible for delivery, and how delivery ended.',
    pipeline: [['01', 'Accepted copy', 'The editor locks the working revision.'], ['02', 'Approved visual', 'An eligible asset is bound to the task.'], ['03', 'One payload', 'Dry run validates exactly what live receives.'], ['04', 'Provider response', 'The adapter receives an object ID or permalink.'], ['05', 'Publication fact', 'The result is recorded only after confirmation.']],
    productLabel: 'The whole system in one project', productTitle: 'Stop searching chats for the current version',
    productText: 'Planner connects strategy, the production plan, channels, tasks, and metrics. Every object has a state and a clear next owner.',
    productAlt: 'ContentOps Studio project overview with channels, tasks, and metrics',
    benefits: [['Context does not restart', 'Agents read one project instead of retelling history to each other.'], ['Decisions differ from drafts', 'The accepted revision and approved visual are explicitly recorded.'], ['Outcomes are verifiable', 'A publication is connected to the provider response and external link.']],
    rolesLabel: 'Seven roles, one project model', rolesTitle: 'Shared context does not mean shared authority',
    rolesText: 'Each agent sees the right part of the workflow and hands over a concrete result.',
    roleGroups: [['Decide', [['Strategist', 'Audience and positioning'], ['Planning HQ', 'Themes, calendar, and dependencies']]], ['Produce', [['Writer', 'Channel native material'], ['Chief Editor', 'Acceptance decision'], ['Art Director', 'Approved visual']]], ['Deliver and learn', [['Publisher', 'Safe delivery'], ['Growth Analyst', 'Metrics and hypotheses']]]],
    connectLabel: 'Connect', connectTitle: 'Start with a project, add roles when you are ready',
    connectText: 'After registration, create a project, approve agent access, and open separate tasks for strategy, content, publishing, and analytics.',
    steps: [['01', 'Create a project', 'Add the product, channels, and operating rules.'], ['02', 'Approve access', 'Authorization binds the agent only to the project you select.'], ['03', 'Open the roles', 'Separate responsibility across Codex tasks.']],
    faqTitle: 'Before you start',
    faq: [['Does ContentOps Studio generate everything?', 'No. It organizes people and agents, preserves accepted decisions, and moves work through governed stages.'], ['Can I connect my own agents?', 'Yes. Access is scoped to a project and role profile, so working context adapts to each user.'], ['Can the system publish without confirmation?', 'Only a role with the right authority receives delivery tools. A publication fact is recorded after the external channel responds.'], ['Are all seven tasks created automatically?', 'The plugin connects roles and project context. Users create separate Codex tasks explicitly to keep control of their workspace.']],
    finalTitle: 'Build one governed content workflow', finalText: 'Start with a project. Add channels, roles, and automation gradually.',
    footer: 'Content operations for teams of people and AI.'
  }
} as const

const navAnchors = ['workflow', 'product', 'roles', 'connect']

export default function Landing() {
  const { locale } = useLocale()
  const c = content[locale]

  useEffect(() => {
    document.title = locale === 'ru' ? 'ContentOps Studio | Контентные операции без потери контекста' : 'ContentOps Studio | Governed Content Operations'
    const nodes = document.querySelectorAll<HTMLElement>('[data-reveal]')
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { (entry.target as HTMLElement).dataset.visible = 'true'; observer.unobserve(entry.target) }
    }), { threshold: 0.08 })
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [locale])

  return <div className="landing-page">
    <a className="landing-skip" href="#main">{locale === 'ru' ? 'К содержанию' : 'Skip to content'}</a>
    <header className="landing-header">
      <Link to="/product" className="landing-brand" aria-label="ContentOps Studio"><img src="/contentops-studio-mark.svg" alt="" /><span>ContentOps Studio</span></Link>
      <nav className="landing-nav" aria-label={locale === 'ru' ? 'Основная навигация' : 'Primary navigation'}>{c.nav.map((item, index) => <a key={item} href={`#${navAnchors[index]}`}>{item}</a>)}</nav>
      <div className="landing-actions"><LanguageSwitcher compact /><Link className="landing-signin" to="/login">{c.login}</Link><Link className="landing-button landing-button-small" to="/register">{c.cta}</Link></div>
    </header>

    <main id="main">
      <section className="landing-hero">
        <div className="landing-hero-copy"><p className="landing-label">{c.heroLabel}</p><h1>{c.heroTitle}</h1></div>
        <div className="landing-hero-side"><p>{c.heroText}</p><div className="landing-hero-actions"><Link className="landing-button" to="/register">{c.cta}<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></Link><a className="landing-secondary" href="#workflow">{c.secondaryCta}</a></div><ul>{c.trust.map((item) => <li key={item}><span className="material-symbols-outlined" aria-hidden="true">check_circle</span>{item}</li>)}</ul></div>
        <figure className="landing-hero-product"><div className="landing-window-bar" aria-hidden="true"><span /><span /><span /><small>ContentOps Studio / publication task</small></div><img src="/landing/publication-workflow.webp" alt={c.heroAlt} fetchPriority="high" width="1440" height="1000" /><figcaption><strong>{c.heroCaption[0]}</strong><span>{c.heroCaption[1]}</span></figcaption></figure>
      </section>

      <section className="landing-pipeline landing-section" id="workflow"><div className="landing-section-intro" data-reveal><p className="landing-label">{c.pipelineLabel}</p><h2>{c.pipelineTitle}</h2><p>{c.pipelineText}</p></div><ol className="landing-pipeline-list">{c.pipeline.map(([number, title, text]) => <li key={number} data-reveal><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></section>

      <section className="landing-product landing-section" id="product"><figure className="landing-product-visual" data-reveal><div className="landing-window-bar" aria-hidden="true"><span /><span /><span /><small>ContentOps Studio / project overview</small></div><img src="/landing/product-overview.webp" alt={c.productAlt} loading="lazy" width="1440" height="1000" /></figure><div className="landing-product-copy" data-reveal><p className="landing-label">{c.productLabel}</p><h2>{c.productTitle}</h2><p className="landing-product-lead">{c.productText}</p><div className="landing-benefits">{c.benefits.map(([title, text], index) => <article key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></div></section>

      <section className="landing-roles landing-section" id="roles"><div className="landing-section-intro landing-roles-intro" data-reveal><p className="landing-label">{c.rolesLabel}</p><h2>{c.rolesTitle}</h2><p>{c.rolesText}</p></div><div className="landing-role-groups">{c.roleGroups.map(([group, roles], groupIndex) => <section key={group} data-reveal><header><span>0{groupIndex + 1}</span><h3>{group}</h3></header><div>{roles.map(([role, output]) => <article key={role}><strong>{role}</strong><p>{output}</p><span className="material-symbols-outlined" aria-hidden="true">east</span></article>)}</div></section>)}</div></section>

      <section className="landing-connect landing-section" id="connect"><div className="landing-connect-copy" data-reveal><p className="landing-label">{c.connectLabel}</p><h2>{c.connectTitle}</h2><p>{c.connectText}</p><Link className="landing-button" to="/register">{c.cta}<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></Link></div><ol className="landing-steps">{c.steps.map(([number, title, text]) => <li key={number} data-reveal><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></section>

      <section className="landing-faq landing-section"><h2 data-reveal>{c.faqTitle}</h2><div className="landing-faq-list">{c.faq.map(([question, answer], index) => <details key={question} open={index === 0} data-reveal><summary>{question}<span className="material-symbols-outlined" aria-hidden="true">add</span></summary><p>{answer}</p></details>)}</div></section>
      <section className="landing-final"><div data-reveal><h2>{c.finalTitle}</h2><p>{c.finalText}</p></div><div className="landing-final-actions"><Link className="landing-button landing-button-inverse" to="/register">{c.cta}<span className="material-symbols-outlined" aria-hidden="true">arrow_forward</span></Link><Link to="/login">{c.login}</Link></div></section>
    </main>

    <footer className="landing-footer"><div className="landing-brand"><img src="/contentops-studio-mark.svg" alt="" /><span>ContentOps Studio</span></div><p>{c.footer}</p><span>© {new Date().getFullYear()}</span></footer>
  </div>
}
