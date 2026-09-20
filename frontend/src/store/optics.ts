import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ExperimentId = 'double' | 'single' | 'newton'

export interface Params {
  wavelength: number      // nm
  slitWidth: number       // μm
  slitSeparation: number  // μm
  screenDistance: number  // mm
}

/** 理论面板状态：ok 正常显示；其余均为空态，不显示数值 */
export type TheoryStatus = 'ok' | 'invalid-params' | 'out-of-range' | 'no-data'

/** 理论结果视图模型：公式说明、单位、精度、空态由同一判定产出，模板只负责渲染 */
export interface TheoryView {
  experiment: ExperimentId
  title: string
  formulas: string[]       // 公式说明（保留现有文案）
  valueLabel: string | null // 理论值符号；null 表示该实验无数值行
  unit: string
  precision: number         // 显示小数位
  status: TheoryStatus
  statusText: string        // 空态提示；ok 时为空串
  value: number | null      // 理论值（unit 单位）；空态为 null
  display: string           // 按 precision 格式化后的值；空态为空串
}

/** 参数合法范围（与滑杆一致），超出即非法参数 */
const PARAM_BOUNDS: Record<keyof Params, { min: number; max: number }> = {
  wavelength: { min: 380, max: 780 },
  slitWidth: { min: 10, max: 200 },
  slitSeparation: { min: 50, max: 500 },
  screenDistance: { min: 100, max: 2000 },
}

/** 各实验理论值实际依赖的参数 */
const REQUIRED_PARAMS: Record<ExperimentId, (keyof Params)[]> = {
  double: ['wavelength', 'slitWidth', 'slitSeparation', 'screenDistance'],
  single: ['wavelength', 'slitWidth', 'screenDistance'],
  newton: ['wavelength'],
}

/** 公式说明与显示元数据（文案保持原有） */
const THEORY_META: Record<ExperimentId, Pick<TheoryView, 'title' | 'formulas' | 'valueLabel' | 'unit' | 'precision'>> = {
  double: {
    title: '双缝干涉',
    formulas: ['亮纹: y = kλL/d (k=0,±1,±2...)', '条纹间距: Δy = λL/d'],
    valueLabel: 'Δy',
    unit: 'mm',
    precision: 2,
  },
  single: {
    title: '单缝衍射',
    formulas: ['暗纹: a·sinθ = kλ', '中央亮纹宽: 2λL/a'],
    valueLabel: '中央宽',
    unit: 'mm',
    precision: 2,
  },
  newton: {
    title: '牛顿环',
    formulas: ['暗环半径: r = √(nλR)', 'R: 曲率半径'],
    valueLabel: null,
    unit: '',
    precision: 0,
  },
}

const STATUS_TEXT: Record<TheoryStatus, string> = {
  ok: '',
  'invalid-params': '参数非法',
  'out-of-range': '超出远场适用范围',
  'no-data': '暂无理论值',
}

function paramInBounds(key: keyof Params, v: number): boolean {
  const b = PARAM_BOUNDS[key]
  return Number.isFinite(v) && v >= b.min && v <= b.max
}

/** 远场(Fraunhofer)适用条件：L ≥ 特征孔径²/λ，不满足时理论公式不适用 */
function farFieldOk(id: ExperimentId, p: Params): boolean {
  const lambda = p.wavelength * 1e-9
  const L = p.screenDistance * 1e-3
  if (id === 'double') return L >= (p.slitSeparation * 1e-6) ** 2 / lambda
  if (id === 'single') return L >= (p.slitWidth * 1e-6) ** 2 / lambda
  return true
}

/** 理论值（mm）；牛顿环无数值行返回 null */
function theoryValue(id: ExperimentId, p: Params): number | null {
  const lambda = p.wavelength * 1e-9
  const L = p.screenDistance * 1e-3
  if (id === 'double') return lambda * L / (p.slitSeparation * 1e-6) * 1e3
  if (id === 'single') return 2 * lambda * L / (p.slitWidth * 1e-6) * 1e3
  return null
}

function formatValue(value: number, precision: number): string {
  return Number.isFinite(value) ? value.toFixed(precision) : ''
}

/** 统一判定：公式说明、单位、精度、空态同源，任何分支都不携带旧值 */
export function assessTheory(id: ExperimentId, p: Params): TheoryView {
  const meta = THEORY_META[id]
  let status: TheoryStatus = 'ok'
  let value: number | null = null

  if (!REQUIRED_PARAMS[id].every(k => paramInBounds(k, p[k]))) {
    status = 'invalid-params'
  } else if (!farFieldOk(id, p)) {
    status = 'out-of-range'
  } else {
    value = theoryValue(id, p)
    if (value !== null && (!Number.isFinite(value) || value <= 0)) {
      status = 'no-data'
      value = null
    }
  }

  return {
    experiment: id,
    ...meta,
    status,
    statusText: STATUS_TEXT[status],
    value,
    display: status === 'ok' && value !== null ? formatValue(value, meta.precision) : '',
  }
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref<ExperimentId>('double')
  const params = ref<Params>({ wavelength: 550, slitWidth: 50, slitSeparation: 200, screenDistance: 1000 })
  const intensityData = ref<number[]>([])
  const theory = ref<TheoryView>(assessTheory(currentExperiment.value, params.value))

  function setExperiment(id: ExperimentId) { currentExperiment.value = id; compute() }

  function simulate(id: ExperimentId): number[] {
    const { wavelength: lam, slitWidth: a, slitSeparation: d, screenDistance: L } = params.value
    const lambda = lam * 1e-9
    const aM = a * 1e-6
    const dM = d * 1e-6
    const LM = L * 1e-3
    const N = 800
    const data: number[] = []
    const xMax = 20e-3

    if (id === 'double') {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const delta = Math.PI * dM * x / (lambda * LM)
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const single = Math.sin(beta) / beta
        const intensity = Math.cos(delta) ** 2 * single ** 2
        data.push(Math.max(0, intensity))
      }
    } else if (id === 'single') {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const intensity = (Math.sin(beta) / beta) ** 2
        data.push(Math.max(0, intensity))
      }
    } else { // newton
      const R = 1.0
      for (let i = 0; i < N; i++) {
        const r = (i / N) * 5e-3
        const path = r * r / (2 * R)
        const phi = 2 * Math.PI * path / lambda + Math.PI
        const intensity = 0.5 * (1 - Math.cos(phi))
        data.push(Math.max(0, intensity))
      }
    }
    return data
  }

  function compute() {
    const id = currentExperiment.value
    // 统一判定理论面板：每次重算产出全新视图，旧结果不残留
    let view = assessTheory(id, params.value)

    // 非法参数：清空数据与结果，直接返回
    if (view.status === 'invalid-params') {
      intensityData.value = []
      theory.value = view
      return
    }

    // 仿真失败或空数据：回退空态，不残留旧值
    try {
      const data = simulate(id)
      if (!data.length) throw new Error('empty intensity data')
      intensityData.value = data
    } catch {
      intensityData.value = []
      view = { ...view, status: 'no-data', statusText: STATUS_TEXT['no-data'], value: null, display: '' }
    }
    theory.value = view
  }

  return { currentExperiment, params, intensityData, theory, setExperiment, compute }
})
