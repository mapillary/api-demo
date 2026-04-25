/* ============================================================
   Api-Demo Regression Tests
   test.js — 零依赖浏览器测试
   ============================================================ */

'use strict';

(function () {

  const DEFAULT_TOKEN = 'MLY|26275324248758064|7819d63bee8179a083cdd76e20557967';

  const UrlState = (function () {

    function serializeFilters(filters) {
      const params = {};
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      if (filters.panoOnly) params.panoOnly = 'true';
      return params;
    }

    function serializeLayerState(state) {
      const params = {};
      if (state.points) params.points = 'true';
      if (state.signs) params.signs = 'true';
      return params;
    }

    function buildQueryString(filters, layerState, options) {
      const params = new URLSearchParams();

      if (filters) {
        const filterParams = serializeFilters(filters);
        Object.keys(filterParams).forEach(k => params.set(k, filterParams[k]));
      }

      if (layerState) {
        const layerParams = serializeLayerState(layerState);
        Object.keys(layerParams).forEach(k => params.set(k, layerParams[k]));
      }

      if (options && options.token && options.token !== options.defaultToken) {
        params.set('token', options.token);
      }

      return params.toString();
    }

    function parseFilters(params) {
      return {
        startDate: params.get('startDate') || '',
        endDate: params.get('endDate') || '',
        panoOnly: params.get('panoOnly') === 'true',
      };
    }

    function parseLayerState(params) {
      return {
        points: params.get('points') === 'true',
        signs: params.get('signs') === 'true',
      };
    }

    function restoreFiltersFromParams(params) {
      return parseFilters(params);
    }

    function restoreLayerStateFromParams(params) {
      return parseLayerState(params);
    }

    function updateUrlFromState(filters, layerState, currentLocation, historyApi) {
      const params = new URLSearchParams(currentLocation.search);

      const filterParams = serializeFilters(filters);
      const layerParams = serializeLayerState(layerState);

      ['startDate', 'endDate', 'panoOnly'].forEach(k => {
        if (filterParams[k]) {
          params.set(k, filterParams[k]);
        } else {
          params.delete(k);
        }
      });

      ['points', 'signs'].forEach(k => {
        if (layerParams[k]) {
          params.set(k, layerParams[k]);
        } else {
          params.delete(k);
        }
      });

      const token = params.get('token');
      if (!token || token === DEFAULT_TOKEN) {
        params.delete('token');
      }

      const queryString = params.toString();
      const pathname = currentLocation.pathname || '/';
      const hash = currentLocation.hash || '';
      const newUrl = queryString
        ? pathname + '?' + queryString + hash
        : pathname + hash;

      const currentFull = pathname + currentLocation.search + hash;
      if (newUrl !== currentFull && historyApi && historyApi.replaceState) {
        historyApi.replaceState(null, '', newUrl);
      }

      return newUrl;
    }

    return {
      serializeFilters,
      serializeLayerState,
      buildQueryString,
      parseFilters,
      parseLayerState,
      restoreFiltersFromParams,
      restoreLayerStateFromParams,
      updateUrlFromState,
    };
  })();

  const TokenState = (function () {

    function resetLayerState(layerState, getElementByIdFn) {
      layerState.points = false;
      layerState.signs = false;

      if (getElementByIdFn) {
        const btnPoints = getElementByIdFn('toggle-points');
        const btnSigns = getElementByIdFn('toggle-signs');
        if (btnPoints && btnPoints.dataset) btnPoints.dataset.active = 'false';
        if (btnSigns && btnSigns.dataset) btnSigns.dataset.active = 'false';
      }

      return layerState;
    }

    function prepareTokenUpdate(options) {
      const result = {
        thumbCacheCleared: false,
        loadedAttributionId: null,
        activeImageId: null,
        layerState: { points: false, signs: false },
      };

      if (options.thumbCache && typeof options.thumbCache.clear === 'function') {
        options.thumbCache.clear();
        result.thumbCacheCleared = true;
      }

      result.loadedAttributionId = null;
      result.activeImageId = null;

      if (options.layerState) {
        resetLayerState(options.layerState, options.getElementById);
        result.layerState = options.layerState;
      }

      return result;
    }

    return {
      resetLayerState,
      prepareTokenUpdate,
    };
  })();

  const TestRunner = (function () {
    const suites = [];
    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    function describe(name, fn) {
      const suite = { name, tests: [] };
      suites.push(suite);
      fn((testName, testFn, desc) => {
        suite.tests.push({ name: testName, fn: testFn, desc: desc || '', status: 'pending', error: null });
        totalTests++;
      });
    }

    function assertEqual(actual, expected, msg) {
      const actualStr = JSON.stringify(actual);
      const expectedStr = JSON.stringify(expected);
      if (actualStr !== expectedStr) {
        throw new Error(`${msg || 'Assertion failed'}\n  Expected: ${expectedStr}\n  Actual:   ${actualStr}`);
      }
    }

    function assertTrue(value, msg) {
      if (!value) {
        throw new Error(msg || 'Expected true, got false');
      }
    }

    function assertFalse(value, msg) {
      if (value) {
        throw new Error(msg || 'Expected false, got true');
      }
    }

    function runSuite(suite) {
      suite.tests.forEach(test => {
        try {
          test.fn();
          test.status = 'pass';
          passedTests++;
        } catch (e) {
          test.status = 'fail';
          test.error = e.message;
          failedTests++;
        }
      });
    }

    function runAll() {
      totalTests = 0;
      passedTests = 0;
      failedTests = 0;
      suites.forEach(s => {
        s.tests.forEach(t => {
          t.status = 'pending';
          t.error = null;
          totalTests++;
        });
      });

      suites.forEach(runSuite);
      render();
    }

    function render() {
      const container = document.getElementById('test-container');
      container.innerHTML = '';

      suites.forEach(suite => {
        const passCount = suite.tests.filter(t => t.status === 'pass').length;
        const totalCount = suite.tests.length;

        const suiteEl = document.createElement('div');
        suiteEl.className = 'test-suite';
        suiteEl.innerHTML = `
          <div class="test-suite-header">
            <div class="test-suite-title">${escapeHtml(suite.name)}</div>
            <div class="test-suite-stats">
              <span class="toggle-icon">▼</span>
              ${passCount}/${totalCount} passed
            </div>
          </div>
          <div class="test-cases">
            ${suite.tests.map(test => `
              <div class="test-case">
                <div class="test-icon ${test.status}">${test.status === 'pass' ? '✓' : test.status === 'fail' ? '✗' : '…'}</div>
                <div class="test-content">
                  <div class="test-name">${escapeHtml(test.name)}</div>
                  ${test.desc ? `<div class="test-desc">${escapeHtml(test.desc)}</div>` : ''}
                  ${test.error ? `<div class="test-error">${escapeHtml(test.error)}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;

        const header = suiteEl.querySelector('.test-suite-header');
        header.addEventListener('click', () => {
          suiteEl.classList.toggle('collapsed');
        });

        container.appendChild(suiteEl);
      });

      document.getElementById('total-count').textContent = totalTests;
      document.getElementById('pass-count').textContent = passedTests;
      document.getElementById('fail-count').textContent = failedTests;
    }

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    return {
      describe,
      assertEqual,
      assertTrue,
      assertFalse,
      runAll,
      render,
    };
  })();

  const { describe, assertEqual, assertTrue, assertFalse } = TestRunner;

  describe('UrlState.serializeFilters', (it) => {
    it('序列化空筛选状态', () => {
      const result = UrlState.serializeFilters({ startDate: '', endDate: '', panoOnly: false });
      assertEqual(result, {});
    }, '空筛选应返回空对象');

    it('序列化带日期的筛选状态', () => {
      const result = UrlState.serializeFilters({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        panoOnly: false
      });
      assertEqual(result, { startDate: '2024-01-01', endDate: '2024-12-31' });
    }, '日期应被包含在结果中');

    it('序列化带全景开关的筛选状态', () => {
      const result = UrlState.serializeFilters({
        startDate: '',
        endDate: '',
        panoOnly: true
      });
      assertEqual(result, { panoOnly: 'true' });
    }, 'panoOnly 为 true 时应返回 "true"');

    it('序列化完整筛选状态', () => {
      const result = UrlState.serializeFilters({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        panoOnly: true
      });
      assertEqual(result, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        panoOnly: 'true'
      });
    }, '所有非空字段都应被包含');
  });

  describe('UrlState.serializeLayerState', (it) => {
    it('序列化空图层状态', () => {
      const result = UrlState.serializeLayerState({ points: false, signs: false });
      assertEqual(result, {});
    }, '图层都关闭时返回空对象');

    it('序列化开启 Map Features 的状态', () => {
      const result = UrlState.serializeLayerState({ points: true, signs: false });
      assertEqual(result, { points: 'true' });
    }, 'points 为 true 时应返回 { points: "true" }');

    it('序列化开启 Traffic Signs 的状态', () => {
      const result = UrlState.serializeLayerState({ points: false, signs: true });
      assertEqual(result, { signs: 'true' });
    }, 'signs 为 true 时应返回 { signs: "true" }');

    it('序列化两个图层都开启的状态', () => {
      const result = UrlState.serializeLayerState({ points: true, signs: true });
      assertEqual(result, { points: 'true', signs: 'true' });
    }, '两个都开启时应包含两个字段');
  });

  describe('UrlState.parseFilters', (it) => {
    it('解析空参数', () => {
      const params = new URLSearchParams('');
      const result = UrlState.parseFilters(params);
      assertEqual(result, { startDate: '', endDate: '', panoOnly: false });
    }, '空参数应返回默认值');

    it('解析 startDate 参数', () => {
      const params = new URLSearchParams('startDate=2024-01-01');
      const result = UrlState.parseFilters(params);
      assertEqual(result.startDate, '2024-01-01');
      assertEqual(result.endDate, '');
      assertFalse(result.panoOnly);
    });

    it('解析完整筛选参数', () => {
      const params = new URLSearchParams('startDate=2024-01-01&endDate=2024-12-31&panoOnly=true');
      const result = UrlState.parseFilters(params);
      assertEqual(result, {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        panoOnly: true
      });
    });

    it('panoOnly 为非 "true" 值时应为 false', () => {
      const params = new URLSearchParams('panoOnly=false');
      const result = UrlState.parseFilters(params);
      assertFalse(result.panoOnly, '"false" 字符串不应解析为 true');
    });
  });

  describe('UrlState.parseLayerState', (it) => {
    it('解析空图层参数', () => {
      const params = new URLSearchParams('');
      const result = UrlState.parseLayerState(params);
      assertEqual(result, { points: false, signs: false });
    });

    it('解析 points=true', () => {
      const params = new URLSearchParams('points=true');
      const result = UrlState.parseLayerState(params);
      assertTrue(result.points);
      assertFalse(result.signs);
    });

    it('解析两个图层都开启', () => {
      const params = new URLSearchParams('points=true&signs=true');
      const result = UrlState.parseLayerState(params);
      assertTrue(result.points);
      assertTrue(result.signs);
    });

    it('points=false 应解析为 false', () => {
      const params = new URLSearchParams('points=false');
      const result = UrlState.parseLayerState(params);
      assertFalse(result.points);
    });
  });

  describe('UrlState.buildQueryString', (it) => {
    it('构建空查询字符串', () => {
      const result = UrlState.buildQueryString(
        { startDate: '', endDate: '', panoOnly: false },
        { points: false, signs: false }
      );
      assertEqual(result, '');
    });

    it('构建带筛选的查询字符串', () => {
      const result = UrlState.buildQueryString(
        { startDate: '2024-01-01', endDate: '', panoOnly: true },
        { points: false, signs: false }
      );
      const params = new URLSearchParams(result);
      assertEqual(params.get('startDate'), '2024-01-01');
      assertEqual(params.get('panoOnly'), 'true');
    });

    it('构建带图层的查询字符串', () => {
      const result = UrlState.buildQueryString(
        { startDate: '', endDate: '', panoOnly: false },
        { points: true, signs: true }
      );
      const params = new URLSearchParams(result);
      assertEqual(params.get('points'), 'true');
      assertEqual(params.get('signs'), 'true');
    });

    it('构建完整查询字符串', () => {
      const result = UrlState.buildQueryString(
        { startDate: '2024-01-01', endDate: '2024-12-31', panoOnly: true },
        { points: true, signs: false }
      );
      const params = new URLSearchParams(result);
      assertEqual(params.get('startDate'), '2024-01-01');
      assertEqual(params.get('endDate'), '2024-12-31');
      assertEqual(params.get('panoOnly'), 'true');
      assertEqual(params.get('points'), 'true');
    });

    it('默认 token 不应包含在查询字符串中', () => {
      const result = UrlState.buildQueryString(
        { startDate: '', endDate: '', panoOnly: false },
        { points: false, signs: false },
        { token: DEFAULT_TOKEN, defaultToken: DEFAULT_TOKEN }
      );
      assertEqual(result, '', '默认 token 不应被序列化');
    });

    it('非默认 token 应包含在查询字符串中', () => {
      const customToken = 'MLY|custom|123456';
      const result = UrlState.buildQueryString(
        { startDate: '', endDate: '', panoOnly: false },
        { points: false, signs: false },
        { token: customToken, defaultToken: DEFAULT_TOKEN }
      );
      const params = new URLSearchParams(result);
      assertEqual(params.get('token'), customToken);
    });
  });

  describe('UrlState.updateUrlFromState', (it) => {
    it('更新 URL 并返回新 URL', () => {
      let replacedUrl = null;
      const mockHistory = {
        replaceState: (state, title, url) => { replacedUrl = url; }
      };
      const mockLocation = {
        pathname: '/',
        search: '',
        hash: '#15.12/40.7128/-74.0060'
      };

      const result = UrlState.updateUrlFromState(
        { startDate: '2024-01-01', endDate: '', panoOnly: true },
        { points: true, signs: false },
        mockLocation,
        mockHistory
      );

      const params = new URLSearchParams(result.split('?')[1].split('#')[0]);
      assertEqual(params.get('startDate'), '2024-01-01');
      assertEqual(params.get('panoOnly'), 'true');
      assertEqual(params.get('points'), 'true');
      assertTrue(result.endsWith('#15.12/40.7128/-74.0060'), 'hash 应被保留');
    });

    it('URL 无变化时不应调用 replaceState', () => {
      let replaceCalled = false;
      const mockHistory = {
        replaceState: () => { replaceCalled = true; }
      };
      const mockLocation = {
        pathname: '/',
        search: '?startDate=2024-01-01&panoOnly=true',
        hash: ''
      };

      const result = UrlState.updateUrlFromState(
        { startDate: '2024-01-01', endDate: '', panoOnly: true },
        { points: false, signs: false },
        mockLocation,
        mockHistory
      );

      assertFalse(replaceCalled, 'URL 无变化时不应调用 replaceState');
    });

    it('应从 URL 中移除默认 token', () => {
      let replacedUrl = null;
      const mockHistory = {
        replaceState: (state, title, url) => { replacedUrl = url; }
      };
      const mockLocation = {
        pathname: '/',
        search: `?token=${encodeURIComponent(DEFAULT_TOKEN)}&points=true`,
        hash: ''
      };

      UrlState.updateUrlFromState(
        { startDate: '', endDate: '', panoOnly: false },
        { points: true, signs: false },
        mockLocation,
        mockHistory
      );

      assertFalse(replacedUrl.includes('token='), '默认 token 应被移除');
      assertTrue(replacedUrl.includes('points=true'), '其他参数应保留');
    });
  });

  describe('TokenState.resetLayerState', (it) => {
    it('应将图层状态重置为 false', () => {
      const state = { points: true, signs: true };
      TokenState.resetLayerState(state, null);
      assertFalse(state.points);
      assertFalse(state.signs);
    });

    it('应更新按钮的 dataset.active', () => {
      const mockBtnPoints = { dataset: { active: 'true' } };
      const mockBtnSigns = { dataset: { active: 'true' } };
      const mockGetElementById = (id) => {
        if (id === 'toggle-points') return mockBtnPoints;
        if (id === 'toggle-signs') return mockBtnSigns;
        return null;
      };

      const state = { points: true, signs: true };
      TokenState.resetLayerState(state, mockGetElementById);

      assertEqual(mockBtnPoints.dataset.active, 'false');
      assertEqual(mockBtnSigns.dataset.active, 'false');
    });

    it('无 getElementById 时不应报错', () => {
      const state = { points: true, signs: true };
      const result = TokenState.resetLayerState(state, null);
      assertFalse(result.points);
      assertFalse(result.signs);
    });
  });

  describe('TokenState.prepareTokenUpdate', (it) => {
    it('应清空 thumbCache', () => {
      const mockCache = new Map();
      mockCache.set('key1', 'value1');
      mockCache.set('key2', 'value2');

      TokenState.prepareTokenUpdate({
        thumbCache: mockCache,
        layerState: { points: true, signs: false }
      });

      assertEqual(mockCache.size, 0, 'thumbCache 应被清空');
    });

    it('应重置图层状态', () => {
      const layerState = { points: true, signs: true };

      const result = TokenState.prepareTokenUpdate({
        thumbCache: new Map(),
        layerState: layerState,
        activeImageId: 'img-123',
        loadedAttributionId: 'img-123'
      });

      assertFalse(layerState.points);
      assertFalse(layerState.signs);
      assertEqual(result.loadedAttributionId, null);
      assertEqual(result.activeImageId, null);
    });

    it('无 thumbCache 时不应报错', () => {
      const result = TokenState.prepareTokenUpdate({
        layerState: { points: false, signs: false }
      });
      assertFalse(result.thumbCacheCleared);
    });
  });

  describe('组合场景: 状态序列化/反序列化 round-trip', (it) => {
    it('筛选状态序列化后应能正确反序列化', () => {
      const original = {
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        panoOnly: true
      };

      const serialized = UrlState.serializeFilters(original);
      const params = new URLSearchParams();
      Object.entries(serialized).forEach(([k, v]) => params.set(k, v));
      const deserialized = UrlState.parseFilters(params);

      assertEqual(deserialized, original);
    });

    it('图层状态序列化后应能正确反序列化', () => {
      const original = { points: true, signs: false };

      const serialized = UrlState.serializeLayerState(original);
      const params = new URLSearchParams();
      Object.entries(serialized).forEach(([k, v]) => params.set(k, v));
      const deserialized = UrlState.parseLayerState(params);

      assertEqual(deserialized, original);
    });

    it('完整状态 round-trip 测试', () => {
      const originalFilters = {
        startDate: '2024-01-01',
        endDate: '',
        panoOnly: true
      };
      const originalLayer = { points: true, signs: true };

      const queryString = UrlState.buildQueryString(originalFilters, originalLayer);
      const params = new URLSearchParams(queryString);
      const restoredFilters = UrlState.parseFilters(params);
      const restoredLayer = UrlState.parseLayerState(params);

      assertEqual(restoredFilters, originalFilters);
      assertEqual(restoredLayer, originalLayer);
    });
  });

  describe('组合场景: Token 切换后的状态恢复顺序', (it) => {
    it('Token 切换后图层状态应被重置', () => {
      const layerState = { points: true, signs: true };
      const thumbCache = new Map([['key', 'value']]);

      TokenState.prepareTokenUpdate({
        thumbCache: thumbCache,
        layerState: layerState
      });

      assertFalse(layerState.points, 'points 应被重置为 false');
      assertFalse(layerState.signs, 'signs 应被重置为 false');
      assertEqual(thumbCache.size, 0, '缓存应被清空');
    });

    it('Token 切换后 URL 状态应独立于图层状态', () => {
      const urlParams = new URLSearchParams('points=true&signs=true&panoOnly=true');
      const restoredLayer = UrlState.parseLayerState(urlParams);
      const restoredFilters = UrlState.parseFilters(urlParams);

      assertTrue(restoredLayer.points);
      assertTrue(restoredLayer.signs);
      assertTrue(restoredFilters.panoOnly);

      const layerState = { points: true, signs: true };
      TokenState.resetLayerState(layerState, null);

      assertFalse(layerState.points);
      assertFalse(layerState.signs);
      assertTrue(restoredLayer.points, 'URL 解析结果不应受重置影响');
    });
  });

  describe('边界情况', (it) => {
    it('空对象应能正确处理', () => {
      const filterResult = UrlState.serializeFilters({});
      const layerResult = UrlState.serializeLayerState({});
      assertEqual(filterResult, {});
      assertEqual(layerResult, {});
    });

    it('空字符串日期应被忽略', () => {
      const result = UrlState.serializeFilters({
        startDate: '',
        endDate: '',
        panoOnly: false
      });
      assertEqual(result, {});
    });

    it('URLSearchParams 解析时参数顺序不影响结果', () => {
      const params1 = new URLSearchParams('startDate=2024-01-01&endDate=2024-12-31');
      const params2 = new URLSearchParams('endDate=2024-12-31&startDate=2024-01-01');

      const result1 = UrlState.parseFilters(params1);
      const result2 = UrlState.parseFilters(params2);

      assertEqual(result1.startDate, result2.startDate);
      assertEqual(result1.endDate, result2.endDate);
    });

    it('panoOnly 只有精确 "true" 才解析为 true', () => {
      const testCases = [
        { input: 'true', expected: true },
        { input: 'TRUE', expected: false },
        { input: 'True', expected: false },
        { input: '1', expected: false },
        { input: 'yes', expected: false },
        { input: 'false', expected: false },
      ];

      testCases.forEach(({ input, expected }) => {
        const params = new URLSearchParams(`panoOnly=${input}`);
        const result = UrlState.parseFilters(params);
        assertEqual(result.panoOnly, expected, `panoOnly="${input}" 应解析为 ${expected}`);
      });
    });
  });

  document.addEventListener('DOMContentLoaded', () => {
    TestRunner.render();
    document.getElementById('run-all-btn').addEventListener('click', TestRunner.runAll);
    TestRunner.runAll();
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { UrlState, TokenState };
  }

})();
