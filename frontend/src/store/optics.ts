import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

export type ExperimentId = 'double' | 'single' | 'newton'
export type TheoryStatus = 'ready' | 'invalid' | 'empty' | 'error'

interface ExperimentParams {
  wavelength: number
  slitWidth: number
  slitSeparation: number
  screenDistance: number
}

interface TheoryConfig {
  title: string
  formulas: string[]
  descriptions: string[]
  showValue: boolean
  valueLabel: string
  unit: string
  precision: number
  calculate?: (params: ExperimentParams) => number
}

export interface TheoryView extends Omit<TheoryConfig, 'calculate'> {
  experimentId: ExperimentId
  status: TheoryStatus
  value: number | null
  message: string
}

const THEORY_CONFIG: Record<ExperimentId, TheoryConfig> = {
  double: {
    title: '双缝干涉',
    formulas: [
      '亮纹: y = kλL/d (k=0,±1,±2...)',
      '条纹间距: Δy = λL/d',
    ],
    descriptions: [],
    showValue: true,
    valueLabel: 'Δy',
    unit: 'mm',
    precision: 2,
    calculate: ({ wavelength, slitSeparation, screenDistance }) =>
      wavelength * 1e-9 * screenDistance * 1e-3 / (slitSeparation * 1e-6) * 1e3,
  },
  single: {
    title: '单缝衍射',
    formulas: [
      '暗纹: a·sinθ = kλ',
      '中央亮纹宽: 2λL/a',
    ],
    descriptions: [],
    showValue: true,
    valueLabel: '中央宽',
    unit: 'mm',
    precision: 2,
    calculate: ({ wavelength, slitWidth, screenDistance }) =>
      2 * wavelength * 1e-9 * screenDistance * 1e-3 / (slitWidth * 1e-6) * 1e3,
  },
  newton: {
    title: '牛顿环',
    formulas: [
      '暗环半径: r = √(nλR)',
    ],
    descriptions: [
      'R: 曲率半径',
    ],
    showValue: false,
    valueLabel: '',
    unit: '—',
    precision: 2,
  },
}

function roundToPrecision(value: number, precision: number) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

export const useOpticsStore = defineStore('optics', () => {
  const currentExperiment = ref<ExperimentId>('double')
  const params = ref<ExperimentParams>({
    wavelength: 550,
    slitWidth: 50,
    slitSeparation: 200,
    screenDistance: 1000,
  })
  const intensityData = ref<number[]>([])
  const theoryView = ref<TheoryView | null>(null)

  const result = computed<{ fringe?: number; centralWidth?: number }>(() => {
    const view = theoryView.value
    if (view?.status !== 'ready' || view.value === null) return {}
    if (view.experimentId === 'double') return { fringe: view.value }
    if (view.experimentId === 'single') return { centralWidth: view.value }
    return {}
  })

  function makeFallbackView(status: Exclude<TheoryStatus, 'ready'>, message: string): TheoryView {
    const config = THEORY_CONFIG[currentExperiment.value]
    return {
      ...config,
      experimentId: currentExperiment.value,
      status,
      value: null,
      message,
    }
  }

  function commitFallback(status: Exclude<TheoryStatus, 'ready'>, message: string) {
    intensityData.value = []
    theoryView.value = makeFallbackView(status, message)
  }

  function validateParameters(experimentId: ExperimentId, value: ExperimentParams): string | null {
    function checkRange(
      input: number,
      min: number,
      max: number,
      label: string,
      rangeText: string,
    ): string | null {
      if (!Number.isFinite(input)) return `${label}必须为有效数字`
      if (input < min || input > max) return `${label}超出适用边界（${rangeText}）`
      return null
    }

    const checks: Array<() => string | null> = [
      () => checkRange(value.wavelength, 380, 780, '波长', '380–780 nm'),
      () => checkRange(value.screenDistance, 100, 2000, '屏幕距离', '100–2000 mm'),
    ]

    if (experimentId !== 'newton') {
      checks.push(() => checkRange(value.slitWidth, 10, 200, '缝宽', '10–200 μm'))
    }

    if (experimentId === 'double') {
      checks.push(() => checkRange(value.slitSeparation, 50, 500, '缝间距', '50–500 μm'))
    }

    for (const check of checks) {
      const message = check()
      if (message) return message
    }

    if (experimentId === 'double' && value.slitSeparation <= value.slitWidth) {
      return '缝间距必须大于缝宽'
    }

    return null
  }

  function generateData(experimentId: ExperimentId, value: ExperimentParams): number[] {
    const { wavelength: lam, slitWidth: a, slitSeparation: d, screenDistance: L } = value
    const lambda = lam * 1e-9
    const aM = a * 1e-6
    const dM = d * 1e-6
    const LM = L * 1e-3
    const N = 800
    const data: number[] = []
    const xMax = 20e-3

    if (experimentId === 'double') {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const delta = Math.PI * dM * x / (lambda * LM)
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const single = Math.sin(beta) / beta
        const intensity = Math.cos(delta) ** 2 * single ** 2
        data.push(Math.max(0, intensity))
      }
    } else if (experimentId === 'single') {
      for (let i = 0; i < N; i++) {
        const x = (i / N - 0.5) * xMax * 2
        const beta = Math.PI * aM * x / (lambda * LM) || 1e-10
        const intensity = (Math.sin(beta) / beta) ** 2
        data.push(Math.max(0, intensity))
      }
    } else {
      const R = 1.0
      for (let i = 0; i < N; i++) {
        const r = (i / N) * 5e-3
        const path = (r * r) / (2 * R)
        const phi = (2 * Math.PI * path) / lambda + Math.PI
        const intensity = 0.5 * (1 - Math.cos(phi))
        data.push(Math.max(0, intensity))
      }
    }

    return data
  }

  function compute() {
    const experimentId = currentExperiment.value
    const config = THEORY_CONFIG[experimentId]
    if (!config) {
      intensityData.value = []
      theoryView.value = {
        experimentId,
        title: '未知实验',
        formulas: [],
        descriptions: [],
        showValue: false,
        valueLabel: '',
        unit: '—',
        precision: 2,
        status: 'error',
        value: null,
        message: '未知实验类型',
      }
      return
    }

    try {
      const invalidMessage = validateParameters(experimentId, params.value)
      if (invalidMessage) {
        commitFallback('invalid', invalidMessage)
        return
      }

      const nextData = generateData(experimentId, params.value)
      if (
        nextData.length === 0 ||
        nextData.some((intensity) => !Number.isFinite(intensity))
      ) {
        commitFallback('empty', '理论数据为空，请调整参数后重试')
        return
      }

      let nextValue: number | null = null
      if (config.showValue) {
        if (!config.calculate) {
          commitFallback('error', '理论计算配置缺失，请重试')
          return
        }
        nextValue = config.calculate(params.value)
        if (!Number.isFinite(nextValue)) {
          commitFallback('empty', '未生成有效理论值，请调整参数后重试')
          return
        }
        nextValue = roundToPrecision(nextValue, config.precision)
      }

      intensityData.value = nextData
      theoryView.value = {
        ...config,
        experimentId,
        status: 'ready',
        value: nextValue,
        message: '',
      }
    } catch {
      commitFallback('error', '理论计算失败，请调整参数后重试')
    }
  }

  function setExperiment(id: string) {
    if (!Object.prototype.hasOwnProperty.call(THEORY_CONFIG, id)) return
    currentExperiment.value = id as ExperimentId
  }

  compute()
  watch(currentExperiment, compute, { flush: 'sync' })
  watch(params, compute, { deep: true, flush: 'sync' })

  return {
    currentExperiment,
    params,
    intensityData,
    theoryView,
    result,
    setExperiment,
    compute,
  }
})
