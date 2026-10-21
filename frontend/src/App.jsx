import { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardCheck,
  CircleDot,
  Download,
  Eye,
  FileSpreadsheet,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
} from 'lucide-react'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')
const api = axios.create({ baseURL: apiBaseUrl, timeout: 120000 })

const fieldRows = [
  ['产品名称', '产品名称'],
  ['产品编号', '产品编号'],
  ['产品特性', '产品特性'],
  ['产品特性和材质', '产品特性和材质'],
  ['产品价格', '产品价格'],
  ['产品的重量', '产品的重量'],
  ['产品的尺寸', '产品的尺寸'],
]

function getErrorMessage(error) {
  const detail = error?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (detail?.message) return detail.message
  return error?.message || '请求失败，请检查 FastAPI 服务是否已启动。'
}

function getStatus(item) {
  if (item.status === 'APPROVED') return '已通过'
  if (item.status === 'PENDING_REVIEW') return '待审核'
  if (item.status === 'AI_GENERATED') return '已生成'
  if (item.status === 'FALLBACK_DRAFT') return '模板草稿待审核'
  if (item.status === 'FAILED') return '处理失败'
  return '原始数据'
}

function StatusPill({ status }) {
  const styles = {
    RAW: 'bg-slate-100 text-slate-600',
    AI_GENERATED: 'bg-sky-50 text-sky-700',
    FALLBACK_DRAFT: 'bg-amber-50 text-amber-800',
    PENDING_REVIEW: 'bg-emerald-100 text-emerald-800',
    APPROVED: 'bg-emerald-50 text-emerald-700',
    FAILED: 'bg-rose-50 text-rose-700',
  }
  return <span className={`status-pill ${styles[status] || styles.RAW}`}>{getStatus({ status })}</span>
}

function App() {
  const [items, setItems] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [workingId, setWorkingId] = useState(null)
  const [importTask, setImportTask] = useState(null)
  const [reviewSelectedCodes, setReviewSelectedCodes] = useState([])
  const [activeView, setActiveView] = useState('review')
  const [summaryRows, setSummaryRows] = useState([])
  const [selectedCodes, setSelectedCodes] = useState([])
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [notice, setNotice] = useState(null)
  const fileInput = useRef(null)
  const progressCursor = useRef(0)

  const selected = useMemo(() => items.find((item) => item.item_code === selectedId), [items, selectedId])
  const reviewCount = items.filter((item) => ['PENDING_REVIEW', 'FALLBACK_DRAFT'].includes(item.status)).length
  const approvedCount = items.filter((item) => item.status === 'APPROVED').length

  async function refreshSummary() {
    setSummaryLoading(true)
    try {
      const { data } = await api.get('/products/summary')
      setSummaryRows(data.products || [])
      setItems((current) => {
        const existing = new Map(current.map((item) => [item.item_code, item]))
        return (data.products || []).map((row) => ({
          ...existing.get(row.item_code),
          item_code: row.item_code,
          raw: row.raw || {},
          copy: row.copy && Object.keys(row.copy).length ? row.copy : null,
          status: row.status,
          thread_id: row.thread_id || existing.get(row.item_code)?.thread_id,
          violations: existing.get(row.item_code)?.violations || [],
        }))
      })
      setSelectedCodes((current) => current.filter((code) => (data.products || []).some((row) => row.item_code === code)))
    } catch (error) {
      setNotice({ type: 'error', text: `商品汇总读取失败：${getErrorMessage(error)}` })
    } finally {
      setSummaryLoading(false)
    }
  }

  useEffect(() => {
    refreshSummary()
  }, [])

  useEffect(() => {
    if (activeView === 'panorama') refreshSummary()
  }, [activeView])

  useEffect(() => {
    if (!importTask || !['processing', 'paused'].includes(importTask.status)) return undefined
    let active = true
    let timer
    const poll = async () => {
      try {
        const { data } = await api.get(`/tasks/${importTask.task_id}/progress`, {
          params: { cursor: progressCursor.current },
        })
        if (!active) return
        setImportTask(data)
        const updates = data.updates || []
        progressCursor.current = data.next_cursor ?? progressCursor.current
        if (updates.length) setItems((current) => current.map((item) => {
          const update = updates.find((entry) => entry.item_code === item.item_code)
          return update ? { ...item, ...update } : item
        }))
        if (data.status === 'completed') {
          const latestSuccess = [...updates].reverse().find((item) => item.copy)
          if (latestSuccess) selectItem({ ...latestSuccess, raw: items.find((item) => item.item_code === latestSuccess.item_code)?.raw || {} })
          await refreshSummary()
          const failures = data.errors?.length || 0
          const invalidRows = data.validation_errors?.length || 0
          setNotice({
            type: failures || invalidRows ? 'warning' : 'success',
            text: `后台处理完成：成功 ${data.success_count}/${data.total_products}${failures ? `，失败 ${failures} 件` : ''}${invalidRows ? `，${invalidRows} 行未通过表格校验` : ''}。`,
            errors: data.validation_errors || [],
          })
          return
        }
      } catch (error) {
        if (active) setNotice({ type: 'error', text: `进度查询失败：${getErrorMessage(error)}` })
      }
      if (active) timer = window.setTimeout(poll, 1000)
    }
    poll()
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [importTask?.task_id, importTask?.status])

  function selectItem(item) {
    setSelectedId(item.item_code)
    setDraft(item.copy ? structuredClone(item.copy) : null)
    setNotice(null)
  }

  async function uploadFile(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!/\.xlsx?$/i.test(file.name)) {
      setNotice({ type: 'error', text: '请选择 .xls 或 .xlsx 文件。' })
      return
    }
    setUploading(true)
    setNotice(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post('/upload', form)
      progressCursor.current = 0
      await refreshSummary()
      setImportTask({ ...data, processed_products: 0, success_count: 0, total_products: 0, products: [], errors: [], validation_errors: [] })
      setNotice({ type: 'success', text: '表格已接收，后台正在逐件生成文案。' })
    } catch (error) {
      setNotice({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setUploading(false)
    }
  }

  async function generate(item) {
    setWorkingId(item.item_code)
    setNotice(null)
    try {
      const { data } = await api.post('/products/process', item.raw)
      const updated = {
        ...item,
        thread_id: data.thread_id,
        copy: data.copy,
        violations: data.violations || [],
        status: data.status || 'PENDING_REVIEW',
        model_source: data.model_source,
        retry_count: data.retry_count,
        process_duration: data.process_duration,
        error_log: data.error_log,
      }
      setItems((current) => current.map((entry) => entry.item_code === item.item_code ? updated : entry))
      selectItem(updated)
      setNotice({
        type: data.status === 'FALLBACK_DRAFT' ? 'warning' : 'success',
        text: data.status === 'FALLBACK_DRAFT'
          ? `${item.item_code} 已使用本地模板生成草稿，请人工检查。`
          : `${item.item_code} 已生成文案并进入审核。`,
      })
    } catch (error) {
      setItems((current) => current.map((entry) => entry.item_code === item.item_code ? { ...entry, status: 'FAILED' } : entry))
      setNotice({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setWorkingId(null)
    }
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function approve(withEdits) {
    if (!selected?.thread_id) return
    setWorkingId(selected.item_code)
    setNotice(null)
    try {
      const payload = withEdits
        ? { action: 'approve_with_edits', copy: draft }
        : { action: 'approve' }
      const { data } = await api.post(`/products/${selected.thread_id}/review`, payload)
      const updated = { ...selected, copy: data.copy, violations: data.violations || [], status: 'APPROVED' }
      setItems((current) => current.map((item) => item.item_code === selected.item_code ? updated : item))
      setDraft(data.copy)
      setNotice({ type: 'success', text: `${selected.item_code} 已审核通过并保存。` })
    } catch (error) {
      setNotice({ type: 'error', text: getErrorMessage(error) })
    } finally {
      setWorkingId(null)
    }
  }

  async function approvePendingQueue() {
    const pending = items.filter((item) => reviewSelectedCodes.includes(item.item_code)
      && ['PENDING_REVIEW', 'FALLBACK_DRAFT'].includes(item.status) && item.thread_id)
    if (!pending.length) return
    if (!window.confirm(`确定直接通过选中的 ${pending.length} 件待审核商品吗？`)) return
    setWorkingId('__batch_approve__')
    const failures = []
    for (let offset = 0; offset < pending.length; offset += 5) {
      const batch = pending.slice(offset, offset + 5)
      const results = await Promise.allSettled(batch.map(async (item) => {
        const { data } = await api.post(`/products/${item.thread_id}/review`, { action: 'approve' })
        setItems((current) => current.map((entry) => entry.item_code === item.item_code
          ? { ...entry, copy: data.copy, violations: data.violations || [], status: 'APPROVED' }
          : entry))
      }))
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          failures.push(`${batch[index].item_code}：${getErrorMessage(result.reason)}`)
        }
      })
    }
    setReviewSelectedCodes((current) => current.filter((code) => !pending.some((item) => item.item_code === code)))
    setWorkingId(null)
    setNotice(failures.length
      ? { type: 'warning', text: `批量审核完成，${pending.length - failures.length} 件通过，${failures.length} 件失败：${failures.join('；')}` }
      : { type: 'success', text: `已批量通过 ${pending.length} 件商品。` })
  }

  async function toggleImportPause() {
    if (!importTask?.task_id) return
    const action = importTask.status === 'paused' ? 'resume' : 'pause'
    try {
      const { data } = await api.post(`/tasks/${importTask.task_id}/${action}`)
      setImportTask((current) => ({ ...current, ...data }))
    } catch (error) {
      setNotice({ type: 'error', text: `批量任务操作失败：${getErrorMessage(error)}` })
    }
  }

  const pendingItems = items.filter((item) => ['PENDING_REVIEW', 'FALLBACK_DRAFT'].includes(item.status) && item.thread_id)
  const allPendingSelected = pendingItems.length > 0
    && pendingItems.every((item) => reviewSelectedCodes.includes(item.item_code))

  function viewSummaryRow(row) {
    const existing = items.find((entry) => entry.item_code === row.item_code)
    const item = {
      item_code: row.item_code,
      raw: row.raw || {},
      copy: row.copy && Object.keys(row.copy).length ? row.copy : null,
      status: row.status,
      thread_id: row.thread_id || existing?.thread_id,
      violations: existing?.violations || [],
    }
    setItems((current) => current.some((entry) => entry.item_code === item.item_code)
      ? current.map((entry) => entry.item_code === item.item_code ? { ...entry, ...item } : entry)
      : [...current, item])
    setActiveView('review')
    selectItem(item)
  }

  async function deleteOne(itemCode) {
    if (!window.confirm(`确定删除商品“${itemCode}”及其全部版本记录吗？此操作不可撤销。`)) return
    try {
      await api.delete(`/products/${encodeURIComponent(itemCode)}`)
      setItems((current) => current.filter((item) => item.item_code !== itemCode))
      setSelectedCodes((current) => current.filter((code) => code !== itemCode))
      if (selectedId === itemCode) {
        setSelectedId(null)
        setDraft(null)
      }
      await refreshSummary()
    } catch (error) {
      setNotice({ type: 'error', text: `删除失败：${getErrorMessage(error)}` })
    }
  }

  async function deleteSelected() {
    if (!selectedCodes.length) return
    if (!window.confirm(`确定批量删除选中的 ${selectedCodes.length} 件商品及全部版本记录吗？此操作不可撤销。`)) return
    try {
      await api.post('/products/batch-delete', { item_codes: selectedCodes })
      const deleted = new Set(selectedCodes)
      setItems((current) => current.filter((item) => !deleted.has(item.item_code)))
      if (deleted.has(selectedId)) {
        setSelectedId(null)
        setDraft(null)
      }
      setSelectedCodes([])
      await refreshSummary()
      setNotice({ type: 'success', text: `已删除 ${deleted.size} 件商品及其版本记录。` })
    } catch (error) {
      setNotice({ type: 'error', text: `批量删除失败：${getErrorMessage(error)}` })
    }
  }

  async function exportSummary() {
    try {
      const response = await api.get('/products/export', { responseType: 'blob' })
      const objectUrl = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = '商品全景数据.xlsx'
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setNotice({ type: 'error', text: `导出失败：${getErrorMessage(error)}` })
    }
  }

  function toggleCode(itemCode) {
    setSelectedCodes((current) => current.includes(itemCode)
      ? current.filter((code) => code !== itemCode)
      : [...current, itemCode])
  }

  const allSelected = summaryRows.length > 0 && summaryRows.every((row) => selectedCodes.includes(row.item_code))

  const isBusy = workingId === selected?.item_code
  const progressPercent = importTask?.total_products
    ? Math.round((importTask.processed_products / importTask.total_products) * 100)
    : 0

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1600px] items-center justify-between px-5 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal text-white">
              <Sparkles size={18} strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold tracking-normal">电商运营 Agent 工作台</h1>
              <p className="hidden text-xs text-muted sm:block">商品文案审核 · Human-in-the-Loop</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              工作区已就绪
            </span>
            <input ref={fileInput} type="file" accept=".xls,.xlsx" className="hidden" onChange={uploadFile} />
            <button className="button-primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <LoaderCircle className="animate-spin" size={16} /> : <Upload size={16} />}
              <span>{uploading ? '正在导入' : '批量导入'}</span>
            </button>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1600px] gap-1 px-5 md:px-8">
          <button className={`top-tab ${activeView === 'review' ? 'top-tab-active' : ''}`} onClick={() => setActiveView('review')}>
            <ClipboardCheck size={15} />文案审核工作台
          </button>
          <button className={`top-tab ${activeView === 'panorama' ? 'top-tab-active' : ''}`} onClick={() => setActiveView('panorama')}>
            <Table2 size={15} />全景数据看板
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-5 md:px-8 md:py-7">
        <section className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-teal">运营控制台</p>
            <h2 className="text-[22px] font-semibold leading-tight">商品文案审核</h2>
          </div>
          <div className="flex items-center gap-5 rounded-lg border border-line bg-white px-4 py-2.5 shadow-sm">
            <div className="flex items-center gap-2 text-sm"><span className="text-muted">商品总数</span><strong>{items.length}</strong></div>
            <span className="h-5 w-px bg-line" />
            <div className="flex items-center gap-2 text-sm"><span className="text-muted">待审核</span><strong className="text-amber-700">{reviewCount}</strong></div>
            <span className="h-5 w-px bg-line" />
            <div className="flex items-center gap-2 text-sm"><span className="text-muted">已通过</span><strong className="text-emerald-700">{approvedCount}</strong></div>
          </div>
        </section>

        {notice && (
          <div className={`mb-4 flex items-start gap-2 rounded-md border px-3.5 py-3 text-sm ${notice.type === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : notice.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {notice.type === 'error' ? <AlertTriangle size={17} className="mt-0.5 shrink-0" /> : <Check size={17} className="mt-0.5 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p>{notice.text}</p>
              {notice.errors?.length > 0 && <p className="mt-1 text-xs">错误行：{notice.errors.map((error) => `${error.row}（${(error.reason || []).join('、')}）`).join('；')}</p>}
            </div>
            <button className="text-xs font-medium" onClick={() => setNotice(null)}>关闭</button>
          </div>
        )}

        {importTask && (
          <section className="mb-5 rounded-lg border border-line bg-white px-4 py-3.5 shadow-sm" aria-live="polite">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                {importTask.status === 'processing' ? <LoaderCircle className="animate-spin text-teal" size={16} /> : <CheckCheck className="text-emerald-700" size={16} />}
                {importTask.status === 'processing' ? '批量生成处理中' : importTask.status === 'paused' ? '批量生成已暂停' : '批量生成已完成'}
                <span className="font-normal text-muted">任务 {importTask.task_id.slice(0, 8)}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">已处理 {importTask.processed_products || 0}/{importTask.total_products || 0} · 成功 {importTask.success_count || 0}</span>
                {['processing', 'paused'].includes(importTask.status) && <button className="button-secondary !min-h-[30px] !px-2.5 !text-[11px]" onClick={toggleImportPause}>
                  {importTask.status === 'paused' ? <Sparkles size={13} /> : <CircleDot size={13} />}
                  {importTask.status === 'paused' ? '继续' : '暂停'}
                </button>}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#E8EEEC]" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
              <div className="h-full rounded-full bg-teal transition-[width] duration-500" style={{ width: `${progressPercent}%` }} />
            </div>
            {importTask.errors?.length > 0 && <p className="mt-2 text-xs text-rose-700">处理失败：{importTask.errors.map((error) => `${error.item_code}（${error.error}）`).join('；')}</p>}
          </section>
        )}

        {activeView === 'panorama' ? (
          <section className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5">
              <div><h2 className="text-sm font-semibold">商品全景数据</h2><p className="mt-0.5 text-xs text-muted">共 {summaryRows.length} 件商品 · 按数据库最新版本汇总</p></div>
              <div className="flex flex-wrap gap-2">
                <button className="button-danger" onClick={deleteSelected} disabled={!selectedCodes.length} title="删除选中商品">
                  <Trash2 size={15} />批量删除{selectedCodes.length ? ` (${selectedCodes.length})` : ''}
                </button>
                <button className="button-secondary" onClick={exportSummary}><Download size={15} />导出 Excel 表格</button>
                <button className="icon-button" onClick={refreshSummary} title="刷新数据" disabled={summaryLoading}><RefreshCw size={15} className={summaryLoading ? 'animate-spin' : ''} /></button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="panorama-table">
                <thead><tr>
                  <th className="w-10"><input type="checkbox" aria-label="全选商品" checked={allSelected} onChange={() => setSelectedCodes(allSelected ? [] : summaryRows.map((row) => row.item_code))} /></th>
                  <th>商品编号</th><th>原始名称</th><th>原始材质 / 尺寸</th><th>AI 生成标题</th><th>卖点预览</th><th>审核状态</th><th className="w-24">操作</th>
                </tr></thead>
                <tbody>
                  {summaryLoading && !summaryRows.length ? <tr><td colSpan="8" className="py-14 text-center text-sm text-muted"><LoaderCircle className="mr-2 inline animate-spin" size={16} />正在读取商品</td></tr> : summaryRows.length ? summaryRows.map((row) => (
                    <tr key={row.item_code}>
                      <td><input type="checkbox" aria-label={`选择 ${row.item_code}`} checked={selectedCodes.includes(row.item_code)} onChange={() => toggleCode(row.item_code)} /></td>
                      <td className="font-mono text-[11px]">{row.item_code}</td>
                      <td className="min-w-[140px] font-medium">{row.product_name || '未提供'}</td>
                      <td className="min-w-[180px] text-xs leading-5 text-muted"><span>{row.material || '材质未提供'}</span><br /><span>{row.dimensions || '尺寸未提供'}</span></td>
                      <td className="min-w-[220px] max-w-[300px] font-medium">{row.title || <span className="font-normal text-muted">尚未生成</span>}</td>
                      <td className="min-w-[250px] max-w-[360px]"><ol className="space-y-1 text-xs leading-5 text-muted">{(row.bullet_points || []).slice(0, 5).map((point, index) => <li key={index} className="line-clamp-1"><span className="mr-1 text-teal">{index + 1}.</span>{point}</li>)}</ol></td>
                      <td><StatusPill status={row.status} /></td>
                      <td><div className="flex items-center gap-1"><button className="icon-button" title="查看 / 编辑" onClick={() => viewSummaryRow(row)}><Eye size={16} /></button><button className="icon-button icon-button-danger" title="删除商品" onClick={() => deleteOne(row.item_code)}><Trash2 size={15} /></button></div></td>
                    </tr>
                  )) : <tr><td colSpan="8" className="py-14 text-center text-sm text-muted">暂无商品数据</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ) : <div className="grid items-start gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={17} className="text-teal" />
                <h3 className="text-sm font-semibold">商品队列</h3>
                <span className="rounded bg-canvas px-1.5 py-0.5 text-[11px] text-muted">{items.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <button className="button-secondary !min-h-[30px] !px-2 !text-[10px]" title="批量通过选中的待审核商品" onClick={approvePendingQueue} disabled={workingId === '__batch_approve__' || reviewSelectedCodes.length === 0}>
                  {workingId === '__batch_approve__' ? <LoaderCircle className="animate-spin" size={13} /> : <CheckCheck size={13} />}
                  批量通过{reviewSelectedCodes.length ? ` (${reviewSelectedCodes.length})` : ''}
                </button>
                <button className="icon-button" title="导入商品表格" onClick={() => fileInput.current?.click()}><Plus size={17} /></button>
              </div>
            </div>
            <div className="border-b border-line px-4 py-3">
              <div className="flex h-9 items-center gap-2 rounded-md border border-line bg-[#FAFBFA] px-3 text-xs text-muted">
                <CircleDot size={14} />
                <span>{reviewCount ? `${reviewCount} 件商品等待审核` : '选择商品查看处理详情'}</span>
                <ChevronDown className="ml-auto" size={14} />
              </div>
            </div>
            {pendingItems.length > 0 && <label className="flex cursor-pointer items-center gap-2 border-b border-line px-4 py-2 text-[11px] text-muted">
              <input type="checkbox" checked={allPendingSelected} onChange={() => setReviewSelectedCodes(allPendingSelected ? [] : pendingItems.map((item) => item.item_code))} />
              全选待审核商品 ({pendingItems.length})
            </label>}
            <div className="max-h-[calc(100vh-285px)] min-h-[270px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-[#EEF5F3] text-teal"><FileSpreadsheet size={20} /></div>
                  <p className="text-sm font-medium">队列暂时为空</p>
                  <p className="mx-auto mt-1 max-w-[220px] text-xs leading-5 text-muted">导入商品表格，数据通过校验后会显示在这里。</p>
                  <button className="button-secondary mt-4" onClick={() => fileInput.current?.click()}><Upload size={15} />导入表格</button>
                </div>
              ) : items.map((item) => (
                <div key={item.item_code} className={`group flex items-start gap-2 border-b border-[#EEF1F0] px-3 py-3.5 transition hover:bg-[#F8FAF9] ${selectedId === item.item_code ? 'bg-[#F0F7F5] shadow-[inset_3px_0_0_#147D72]' : ''}`}>
                  {['PENDING_REVIEW', 'FALLBACK_DRAFT'].includes(item.status) && item.thread_id && <input type="checkbox" className="mt-2 accent-teal" aria-label={`选择待审核商品 ${item.item_code}`} checked={reviewSelectedCodes.includes(item.item_code)} onChange={() => setReviewSelectedCodes((current) => current.includes(item.item_code) ? current.filter((code) => code !== item.item_code) : [...current, item.item_code])} />}
                  <button onClick={() => selectItem(item)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                  <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md ${item.status === 'APPROVED' || item.status === 'PENDING_REVIEW' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                    {item.status === 'APPROVED' ? <CheckCheck size={16} /> : item.status === 'PENDING_REVIEW' ? <ShieldCheck size={16} /> : <PackageCheck size={16} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{item.raw['产品名称']}</span>
                      <ArrowRight size={14} className={`shrink-0 text-muted transition ${selectedId === item.item_code ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100'}`} />
                    </div>
                    <p className="mt-1 truncate font-mono text-[11px] text-muted">{item.item_code}</p>
                    <div className="mt-2"><StatusPill status={item.status} /></div>
                  </div>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line bg-[#FAFBFA] px-4 py-3 text-[11px] text-muted">
              <span>RAW → AI_GENERATED → PENDING_REVIEW → APPROVED</span>
            </div>
          </aside>

          <section className="min-w-0">
            {!selected ? (
              <div className="grid min-h-[500px] place-items-center rounded-lg border border-dashed border-[#C9D5D1] bg-white">
                <div className="px-5 text-center">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#EEF5F3] text-teal"><ShieldCheck size={22} /></div>
                  <h3 className="text-sm font-semibold">选择一件商品开始审核</h3>
                  <p className="mt-1.5 text-xs text-muted">商品参数、生成文案与质检结果会显示在此处。</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3.5 shadow-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#EEF5F3] text-teal"><PackageCheck size={18} /></div>
                    <div className="min-w-0"><h3 className="truncate text-sm font-semibold">{selected.raw['产品名称']}</h3><p className="mt-0.5 truncate font-mono text-[11px] text-muted">{selected.item_code}</p></div>
                  </div>
                  <StatusPill status={selected.status} />
                </div>

                <div className="rounded-lg border border-line bg-white shadow-panel">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <div><h3 className="text-sm font-semibold">原始参数快照</h3><p className="mt-0.5 text-xs text-muted">来自导入表格的商品信息</p></div>
                    <span className="rounded border border-line px-2 py-1 text-[10px] font-semibold text-muted">RAW</span>
                  </div>
                  <dl className="grid gap-x-6 px-4 py-2 sm:grid-cols-2 xl:grid-cols-3">
                    {fieldRows.map(([key, label]) => (
                      <div key={key} className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] gap-2 border-b border-[#EEF1F0] py-3 last:border-0 sm:last:border-b xl:nth-last-2:border-0">
                        <dt className="text-xs text-muted">{label}</dt><dd className="break-words text-xs font-medium">{selected.raw[key] || '未提供'}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {selected.status === 'RAW' || selected.status === 'FAILED' ? (
                  <div className="rounded-lg border border-line bg-white px-5 py-7 text-center shadow-panel">
                    <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-[#E9F4F2] text-teal"><Sparkles size={19} /></div>
                    <h3 className="mt-3 text-sm font-semibold">生成商品文案</h3>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted">根据当前商品参数生成标题、卖点和详情，并在完成质检后进入人工审核。</p>
                    <button className="button-primary mt-4" onClick={() => generate(selected)} disabled={isBusy}>
                      {isBusy ? <LoaderCircle className="animate-spin" size={16} /> : selected.status === 'FAILED' ? <RefreshCw size={16} /> : <Sparkles size={16} />}
                      {isBusy ? '正在处理' : selected.status === 'FAILED' ? '重试生成' : '生成并进入审核'}
                    </button>
                  </div>
                ) : selected.copy && draft ? (
                  <div className="overflow-hidden rounded-lg border border-line bg-white shadow-panel">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                      <div><h3 className="text-sm font-semibold">文案审核与编辑</h3><p className="mt-0.5 text-xs text-muted">检查生成内容与质检提示，确认后批准</p></div>
                      <span className="rounded border border-sky-100 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-700">AI_GENERATED</span>
                    </div>
                    <div className="space-y-5 p-4 md:p-5">
                      <label className="block">
                        <span className="field-label">商品标题 <span className="font-normal text-muted">{draft.title?.length || 0} 字</span></span>
                        <input className="text-input mt-2" value={draft.title || ''} onChange={(event) => updateDraft('title', event.target.value)} disabled={selected.status === 'APPROVED'} />
                      </label>

                      <div>
                        <div className="mb-2 flex items-center justify-between"><span className="field-label">商品卖点</span><span className="text-[11px] text-muted">5 条</span></div>
                        <div className="space-y-2">
                          {(draft.bullet_points || []).map((point, index) => (
                            <div key={index} className="flex items-start gap-2">
                              <span className="mt-2.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-[#F0F3F2] text-[10px] font-semibold text-muted">{String(index + 1).padStart(2, '0')}</span>
                              <input className="text-input" value={point} onChange={(event) => updateDraft('bullet_points', draft.bullet_points.map((entry, pointIndex) => pointIndex === index ? event.target.value : entry))} disabled={selected.status === 'APPROVED'} />
                            </div>
                          ))}
                        </div>
                      </div>

                      <label className="block"><span className="field-label">详情描述</span><textarea className="text-input mt-2 min-h-[100px] resize-y leading-6" value={draft.description || ''} onChange={(event) => updateDraft('description', event.target.value)} disabled={selected.status === 'APPROVED'} /></label>
                      <label className="block"><span className="field-label">搜索关键词</span><input className="text-input mt-2" value={(draft.keywords || []).join('，')} onChange={(event) => updateDraft('keywords', event.target.value.split(/[，,]/).map((word) => word.trim()).filter(Boolean))} disabled={selected.status === 'APPROVED'} /></label>

                      <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-2">
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-800"><AlertTriangle size={14} />待核实信息</div>
                          <div className="flex min-h-8 flex-wrap gap-1.5">
                            {(draft.unverified_fields || []).length ? draft.unverified_fields.map((field) => <span key={field} className="rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800">{field}</span>) : <span className="text-xs text-muted">暂无</span>}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-rose-700"><ShieldCheck size={14} />质检违规项</div>
                          <div className="flex min-h-8 flex-wrap gap-1.5">
                            {selected.violations.length ? selected.violations.map((violation, index) => <span key={`${violation}-${index}`} className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{violation}</span>) : <span className="text-xs text-emerald-700">未发现违规项</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col-reverse justify-between gap-3 border-t border-line bg-[#FAFBFA] px-4 py-3.5 sm:flex-row sm:items-center">
                      <p className="text-[11px] text-muted">{selected.status === 'APPROVED' ? '该商品已完成审核。' : '批准后将写入商品版本记录。'}</p>
                      {selected.status !== 'APPROVED' && <div className="flex flex-wrap justify-end gap-2">
                        <button className="button-secondary" onClick={() => approve(false)} disabled={isBusy}>
                          {isBusy ? <LoaderCircle className="animate-spin" size={15} /> : <Check size={15} />}
                          直接通过
                        </button>
                        <button className="button-primary" onClick={() => approve(true)} disabled={isBusy}>
                          {isBusy ? <LoaderCircle className="animate-spin" size={15} /> : <CheckCheck size={15} />}
                          保存修改并批准
                        </button>
                      </div>}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>}
      </main>
    </div>
  )
}

export default App
