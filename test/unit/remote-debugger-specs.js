// transpile:mocha

import { RemoteDebugger, DEBUGGER_TYPES } from '../../index.js';
import { RemoteDebuggerServer, APP_INFO } from '../helpers/remote-debugger-server';
import { withConnectedServer } from '../helpers/server-setup';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import B from 'bluebird';
import { MOCHA_TIMEOUT } from '../helpers/helpers';


chai.should();
chai.use(chaiAsPromised);


describe('RemoteDebugger', function () {
  this.timeout(MOCHA_TIMEOUT);

  let rd;
  let rds = [];
  beforeEach(function () {
    const opts = {
      bundleId: APP_INFO['PID:42'].bundleId,
      platformVersion: '8.3',
      useNewSafari: true,
      pageLoadMs: 5000,
      port: 27754,
      debuggerType: DEBUGGER_TYPES.webinspector,
      garbageCollectOnExecute: true,
    };
    rd = new RemoteDebugger(opts);
    rds[0] = rd;
  });

  function requireAppIdKey (fn, args) {
    it('should fail if no app selected', async function () {
      // make sure there is no app id key (set during selectApp)
      rd.appIdKey = null;

      await rd[fn](...args).should.be.rejectedWith('appIdKey');
    });
  }
  function requirePageIdKey (fn, args) {
    it('should fail if no page selected', async function () {
      // make sure there is no page id key (set during selectPage)
      rd.pageIdKey = null;

      await rd[fn](...args).should.be.rejectedWith('pageIdKey');
    });
  }
  function confirmRpcSend (fn, args, num = 1) {
    it('should send an rpc message', async function () {
      let spy = sinon.spy(rd.rpcClient, 'send');
      await rd[fn](...args);
      spy.callCount.should.equal(num);
    });
  }
  function confirmRemoteDebuggerErrorHandling (server, fn, args, gc = false, errText = 'remote debugger error') {
    it('should handle error from remote debugger', async function () {
      if (gc) {
        server.setDataResponseValue('');
      }
      server.setDataResponseError(errText);
      await rd[fn](...args).should.be.rejectedWith(errText);
    });
  }

  describe('#connect', function () {
    this.retries(3);

    let server = new RemoteDebuggerServer();

    beforeEach(async function () {
      await server.start();
    });
    afterEach(async function () {
      await server.stop();
    });

    it('should return application information', async function () {
      let spy = sinon.spy(rd, 'setConnectionKey');
      (await rd.connect()).should.eql(APP_INFO);
      spy.calledOnce.should.be.true;
    });
    it('should set the connection key', async function () {
      let spy = sinon.spy(rd, 'setConnectionKey');
      await rd.connect();
      spy.calledOnce.should.be.true;
    });
  });

  describe('#disconnect', withConnectedServer(rds, () => {
    it('should disconnect from the rpc client', async function () {
      let spy = sinon.spy(rd.rpcClient, 'disconnect');
      await rd.disconnect();
      spy.calledOnce.should.be.true;
      spy.restore();
    });
    it('should emit an appropriate event', async function () {
      let spy = sinon.spy();
      rd.on(RemoteDebugger.EVENT_DISCONNECT, spy);
      await rd.disconnect();
      spy.calledOnce.should.be.true;
    });
  }));

  describe('#selectApp', withConnectedServer(rds, (server) => {
    confirmRpcSend('selectApp', [], 1);
    it('should be able to handle an app change event before selection', async function () {
      this.timeout(10000);

      let initialIdKey = rd.appIdKey;
      // change the app immediately
      server.changeApp(1, true);

      // need to wait for the change to have been received
      // wait up to 2 seconds
      let timeout = 2000;
      let start = Date.now();
      while (Date.now() <= (start + timeout)) {
        // once the appIdKey has changed, we are good to go
        if (rd.appIdKey !== initialIdKey) {
          break;
        }
        await B.delay(100);
      }

      let spy = sinon.spy(rd.rpcClient, 'selectApp');
      let selectPromise = rd.selectApp();

      server.sendPageInfoMessage('PID:42');
      server.sendPageInfoMessage('PID:44');

      await selectPromise;

      rd.appIdKey.should.equal('PID:42');
      spy.calledOnce.should.be.true;
    });
    it('should be able to handle an app change event during selection', async function () {
      // change the app when the selectApp call gets in
      server.changeApp(1, false);

      let spy = sinon.spy(rd.rpcClient, 'selectApp');
      let selectPromise = rd.selectApp();

      await B.delay(1000);
      server.sendPageInfoMessage('PID:44');
      server.sendPageInfoMessage('PID:42');
      server.sendPageInfoMessage('PID:46');

      await selectPromise;

      spy.calledTwice.should.be.true;
    });
    it('should not connect to app if url is about:blank and ignoreAboutBlankUrl is passed true to selectApp', async function () {
      let selectPromise = rd.selectApp({ignoreAboutBlankUrl: true});

      try {
        await selectPromise;
      } catch (err) {
        err.message.should.include('Could not connect to a valid app');
      }
    });
  }));

  describe('#selectPage', withConnectedServer(rds, (server) => {
    confirmRpcSend('selectPage', [1, 2, true], 2);
    confirmRpcSend('selectPage', [1, 2, false], 6);
    confirmRemoteDebuggerErrorHandling(server, 'selectPage', [1, 2]);
  }));

  describe('#execute', withConnectedServer(rds, () => {
    requireAppIdKey('execute', []);
    requirePageIdKey('execute', []);
    confirmRpcSend('execute', ['document.getElementsByTagName("html")[0].outerHTML'], 2);
  }));

  describe('#checkPageIsReady', withConnectedServer(rds, (server) => {
    requireAppIdKey('checkPageIsReady', []);
    confirmRpcSend('checkPageIsReady', [], 2);
    it('should return true when server responds with complete', async function () {
      server.setDataResponseValue('');
      server.setDataResponseValue('complete');
      let ready = await rd.checkPageIsReady();
      ready.should.be.true;
    });
    it('should return false when server responds with loading', async function () {
      server.setDataResponseValue('');
      server.setDataResponseValue('loading');
      let ready = await rd.checkPageIsReady();
      ready.should.be.false;
    });
    confirmRemoteDebuggerErrorHandling(server, 'checkPageIsReady', [], true);
  }));

  describe('#executeAtom', withConnectedServer(rds, (server) => {
    confirmRpcSend('executeAtom', ['find_element', [], []], 2);
    it('should execute the atom', async function () {
      let sentElement = {ELEMENT: ':wdc:1435784377545'};
      server.setDataResponseValue('');
      server.setDataResponseValue(sentElement);
      let element = await rd.executeAtom('find_element', [], []);
      element.should.eql(sentElement);
    });
    confirmRemoteDebuggerErrorHandling(server, 'executeAtom', ['find_element', [], []], true);
  }));

  describe('timeline', withConnectedServer(rds, () => {
    describe('#startTimeline', function () {
      let timelineCallback = sinon.spy();
      confirmRpcSend('startTimeline', [timelineCallback]);
    });

    describe('#stopTimeline', function () {
      confirmRpcSend('stopTimeline', []);
    });
  }));

  describe('#waitForFrameNavigated', withConnectedServer(rds, (server) => {
    it('should work when the delay is cancelled but the server sends message', async function () {
      let p = rd.waitForFrameNavigated();
      rd.navigationDelay.cancel();

      // make the server send the navigation message
      server.sendFrameNavigationMessage();

      // wait for rd.waitForFrameNavigated() to finish
      let source = await p;
      source.should.equal('remote-debugger');
    });
    it('should timeout and finish when server does not send message', async function () {
      let source = await rd.waitForFrameNavigated();
      source.should.equal('timeout');
    });
  }));

  describe('#navToUrl', withConnectedServer(rds, () => {
    let url = 'http://appium.io';

    requireAppIdKey('navToUrl', [url]);
    requirePageIdKey('navToUrl', [url]);
    confirmRpcSend('navToUrl', [url], 3);
  }));

  describe('#callFunction', withConnectedServer(rds, () => {
    requireAppIdKey('callFunction', []);
    requirePageIdKey('callFunction', []);
    confirmRpcSend('callFunction', [], 2);
  }));

  describe('#pageLoad', withConnectedServer(rds, (server) => {
    it('should call #checkPageIsReady', async function () {
      let spy = sinon.spy(rd, 'checkPageIsReady');
      await rd.pageLoad();
      spy.calledOnce.should.be.true;
    });
    it('should not call #checkPageIsReady if delay is cancelled', async function () {
      let spy = sinon.spy(rd, 'checkPageIsReady');
      let p = rd.pageLoad();
      rd.pageLoadDelay.cancel();
      await p;
      spy.called.should.be.false;
    });
    it('should retry if page is not ready', async function () {
      // give a long timeout so we can get the response from the server
      rd.pageLoadMs = 10000;

      // make the server respond first with random status, then with complete
      server.setDataResponseValue('');
      server.setDataResponseValue('loading');
      server.setDataResponseValue('');
      server.setDataResponseValue('complete');

      let spy = sinon.spy(rd, 'checkPageIsReady');
      await rd.pageLoad();
      spy.calledTwice.should.be.true;
    });
  }));

  describe('socket errors', function () {
    it('should handle socket connect error', async function () {
      await rd.connect().should.be.rejected;
    });
  });
});
