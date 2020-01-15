// ==UserScript==
// @name         numbeo-cost-of-living-comparison
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Visualize cost-of-living data diff from numbeo
// @author       neotan
// @match        https://www.numbeo.com/*
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource     tabulatorCss https://cdn.jsdelivr.net/npm/tabulator-tables@4.5.3/dist/css/tabulator.min.css
// @require      https://cdn.jsdelivr.net/npm/echarts@4.6.0/dist/echarts.min.js
// @require      https://cdn.jsdelivr.net/npm/tabulator-tables@4.5.3/dist/js/tabulator.min.js
// @require      https://cdn.jsdelivr.net/npm/ramda@0.26.1/dist/ramda.min.js
// ==/UserScript==

(async function () {
  'use strict'

  //------------------- Utilities START -------------------//
  const renameKeys = (cityName, rows) => {
    if (!rows) return

    return R.map(
      R.pipe(
        R.toPairs,
        R.map(([key, val]) => ['idx', 'item', 'category'].includes(key)
                              ? [key, val]
                              : [`${cityName}-${key}`, val]),
        R.fromPairs,
      ),
    )(rows)
  }

  const camelize = (str) => {
    if (!str) return str

    return R.replace(/(?<=^|-)./g, R.toUpper)(str)
  }

  const toNumber = str => {
    if (str == null) return

    const numArr = str.trim().match(/[\d.-]/g)
    return numArr == null ? numArr : parseFloat(numArr.join(''))
  }

  const scrollTo = (htmlSelector) => {
    setTimeout(() => {
      const scrollTop = $(htmlSelector).position().top || 0

      $('html, body').animate({scrollTop}, 'slow')
    }, 3000)
  }

  const citiesStrToArray = (citiesStr) => {
    if (!citiesStr) return

    return R.pipe(
      R.split(','),
      R.map(R.pipe(R.trim, R.toLower, camelize)),
    )(citiesStr)
  }

  const extractCostFromDoc = (doc = '') => {
    const trs = $(doc).find('table.data_wide_table tr')
    if (trs.length === 0) return

    let category = 'Unknown'

    return trs
      .toArray()
      .map((tr, idx) => {
        const ths = $(tr).find('th')
        const tds = $(tr).find('td')
        let item
        let median
        let range

        if (ths.length > 0) {
          category = ths.eq(0).text().trim()
        } else if (tds.length > 0) {
          item = tds.eq(0).text().trim()
          median = toNumber(tds.eq(1).text().trim())
          range = tds.eq(2).text().trim()
        }

        return item === null ? null : {idx, category, item, median, range}
      })
      .filter(row => row.item)
  }

  const cityCostUrl = 'https://www.numbeo.com/cost-of-living/in/'
  const fetchCityCostByName = async (cityName) => {
    try {
      const response = await fetch(`${cityCostUrl}${cityName}`)
      return response.text() // return a promise
    } catch (err) {
      console.warn(err)
    }
  }

  const createSubColumns = (data, showedSubColumnKeys = []) => {
    if (!data) return

    return R.pipe(
      R.mapObjIndexed(
        (rows = [], cityName) => {
          const columns = R.pipe(
            R.prop(0),
            R.pick(showedSubColumnKeys),
            R.keys,
            R.map(key => ({title: key, field: `${cityName}-${key}`, sorter: 'number', align: 'right'})),
          )(rows)

          return {
            title: cityName,
            columns,
          }
        },
      ),
      R.values,
      R.flatten,
    )(data)
  }

  const convertDataToRows = R.pipe(
    R.mapObjIndexed((rows, cityName) => {
      return renameKeys(cityName, rows)
    }),
    R.values,
    R.reduce((acc, curr, i) => acc == null ? curr : acc.map((obj, i) => R.mergeRight(obj, curr[i])), null),
  )

  const getBarChartOption = (cities = [], rows = []) => {
    const sortedRows = R.pipe(
      R.map(row => {
        const sumMedian = R.pipe(
          R.pickBy((_, key) => key.endsWith('-median')),
          R.values,
          R.sum,
        )(row)

        return {...row, sumMedian}
      }),
      R.sortBy(R.prop('sumMedian')),
    )(rows)

    const items = R.pluck('item')(sortedRows)

    const series = R.map(city => {
      const name = city
      const data = R.pluck(`${city}-median`)(sortedRows)
      return {name, data, type: 'bar'}
    })(cities)

    const option = {
      title: {
        text: 'Cost of Living',
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
      },
      toolbox: {
        show: true,
        feature: {
          dataView: {title: 'View Data', readOnly: false},
          restore: {title: 'Restore'},
        },
      },
      calculable: true,
      legend: {
        data: cities,
        align: 'right',
        selector: [
          {
            type: 'all',
            title: 'All',
          },
          {
            type: 'inverse',
            title: 'Inverse',
          },
        ],
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        name: 'USD',
        type: 'value',
      },
      yAxis: {
        type: 'category',
        data: items,
      },
      dataZoom: [
        {
          show: true,
          top: '97%',
        },
        {
          show: true,
          yAxisIndex: 0,
          filterMode: 'none',
          width: 30,
          height: '80%',
          left: '95%',
          start: 80,
          end: 100,
        },
      ],
      series,
    }

    return option
  }

  //------------------- Utilities END -------------------//

  //------------------- Main Functions declaration START -------------------//
  const defaultCities = 'irvine,seattle,los-angeles,austin,new-york,hoboken'
  let defaultColumns
  let showedSubColumnKeys
  let domHtml
  let costData
  let barChart

  const initEnv = (cityNames) => {
    defaultColumns = [{title: 'Category', field: 'category'}, {title: 'Item', field: 'item'}]
    showedSubColumnKeys = ['median']
    domHtml = `
<form class="cities-form">
<div>

<label>
Cities: <input type="text" name="cities" size=100 style="background-color: lightgreen;" placeholder="Input city names here."
value=${cityNames.join(',')}>
</label>

<input type="submit">
</div>
</form>


<div>
<button class="toggle-barchart" style="background-color: lightgreen;">Toggle Bar-Chart</button>
<div id="echarts" style="width: 80%; height:700px;"/>
<button class="toggle-table" style="background-color: lightgreen;">Toggle Table</button>
<div id="tabulator-table" style="width: 80%;"/>
</div>
`

    GM_addStyle(GM_getResourceText('tabulatorCss'))
    $('body').prepend($(domHtml))

    // initiate Charts
    barChart = echarts.init(document.getElementById('echarts'))
    barChart.showLoading({
      text: 'Loading...',
    })

    // initiate listener
    $('.toggle-barchart').click(() => $('#echarts').slideToggle('fast'))
    $('.toggle-table').click(() => $('#tabulator-table').slideToggle('fast'))
    $('.cities-form').submit(function (event) {
      event.preventDefault()

      const cityNames = R.pipe(
        () => $(this).serializeArray(),
        R.pathOr('', [0, 'value']),
        citiesStrToArray,
      )(event)


      if (cityNames) {
        barChart.showLoading({
          text: 'Loading...',
        })
        buildExtraDoms(cityNames)
        return
      }
    })
    console.log('init DONE!')
  }

  const buildExtraDoms = async (cityNames) => {
    if (!cityNames || cityNames.length <= 0) return

    try {
      const promises = R.map(fetchCityCostByName)(cityNames)
      const docs = await Promise.all(promises)

      costData = R.pipe(
        R.zipObj(cityNames),
        R.map(extractCostFromDoc),
        R.reject(R.isNil),
      )(docs)

      const rows = convertDataToRows(costData)

      // create Table
      new Tabulator('#tabulator-table', { // options ref: http://tabulator.info/examples/4.5
        height: '500px',
        movableColumns: true,
        columns: [...defaultColumns, ...createSubColumns(costData, showedSubColumnKeys)],
        data: convertDataToRows(costData),
      })

      // create Charts
      const cities = R.keys(costData)
      barChart.setOption(getBarChartOption(cities, rows), true)
      barChart.hideLoading()


      scrollTo('.cities-form')
    } catch (err) {
      console.warn(err)
    }
  }

  //------------------- Main Functions declaration END -------------------//

  //------------------- Main Functions execution START -------------------//
  const urlParams = new URLSearchParams(window.location.search)
  const citiesStr = urlParams.get('cities')
  const cityNames = citiesStrToArray(citiesStr || defaultCities)

  initEnv(cityNames)
  buildExtraDoms(cityNames)
})()
