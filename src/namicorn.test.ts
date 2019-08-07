import nock from 'nock';
import Namicorn from './namicorn';
import _ from 'lodash';
import mockData from './testData/mockData.json';
import Ens from './ens';

const DEFAULT_URL = 'https://unstoppabledomains.com/api/v1';
const MAINNET_URL = 'https://mainnet.infura.io';
const ZILLIGA_URL = 'https://api.zilliqa.com';

const mockAPICalls = (topLevel, testName, url = MAINNET_URL) => {
  const mockCall = mockData[topLevel][testName];

  mockCall.forEach(({ METHOD, REQUEST, RESPONSE }) => {
    switch (METHOD) {
      case 'POST': {
        nock(url)
          .log(console.log)
          .post('/', JSON.stringify(REQUEST))
          .reply(200, JSON.stringify(RESPONSE));
      }
      default: {
        nock(url)
          .log(console.log)
          .get(REQUEST)
          .reply(200, RESPONSE);
      }
    }
  });
};

beforeEach(() => {
  setTimeout(() => {
    if (!nock.isDone()) {
      console.error('pending mocks: %j', nock.pendingMocks());
    }
    nock.cleanAll();
  }, 10000);
});

it('should work', async () => {
  nock.cleanAll();
  const testName = 'should work';
  mockAPICalls('UD_API', testName, DEFAULT_URL);
  const namicorn = new Namicorn();
  const result = await namicorn.address('cofounding.zil', 'eth');
  expect(result).toEqual('0xaa91734f90795e80751c96e682a321bb3c1a4186');
});

it('resolves .eth name using blockchain', async () => {
  const testName = 'resolves .eth name using blockchain';
  mockAPICalls('ENS', testName, MAINNET_URL);

  const namicorn = new Namicorn({
    blockchain: { ens: MAINNET_URL },
  });
  var result = await namicorn.address('matthewgould.eth', 'ETH');
  expect(result).toEqual('0x714ef33943d925731FBB89C99aF5780D888bD106');
});

// it('reverses address to ENS domain', async () => {
//   const testName = 'reverses address to ENS domain';
//   mockAPICalls('ENS', testName, MAINNET_URL);
//   let ens = new Ens(MAINNET_URL);
//   const result = await ens.reverse(
//     '0xb0E7a465D255aE83eb7F8a50504F3867B945164C',
//     'ETH',
//   );
//   expect(result).toEqual('adrian.argent.xyz');
// });

// it('reverses address to ENS domain null', async () => {
//   const testName = 'reverses address to ENS domain null';
//   mockAPICalls('ENS', testName, MAINNET_URL);
//   const ens = new Ens(MAINNET_URL);
//   var result = await ens.reverse(
//     '0x112234455c3a32fd11230c42e7bccd4a84e02010',
//     'ETH',
//   );
//   expect(result).toEqual(null);
// });

// it('resolves .xyz name using ENS blockchain', async () => {
//   nock.cleanAll();
//   const testName = 'resolves .xyz name using ENS blockchain';
//   mockAPICalls('ENS', testName, MAINNET_URL);
//   const namicorn = new Namicorn({
//     blockchain: { ens: MAINNET_URL },
//   });
//   const result = await namicorn.address('adrian.argent.xyz', 'ETH');
//   expect(result).toEqual('0xb0E7a465D255aE83eb7F8a50504F3867B945164C');
// });

// it('resolves .luxe name using ENS blockchain', async () => {
//   nock.cleanAll();
//   const testName = 'resolves .luxe name using ENS blockchain';
//   mockAPICalls('ENS', testName, MAINNET_URL);
//   const namicorn = new Namicorn({
//     blockchain: { ens: MAINNET_URL },
//   });
//   //TODO find luxe domain that resolves
//   const result = await namicorn.address('bogdantest.luxe', 'ETH');
//   expect(result).toEqual(null);
// });

it('resolves .zil name using blockchain', async () => {
  nock.cleanAll();
  const testName = 'resolves .zil name using blockchain';
  mockAPICalls('ZIL', testName, ZILLIGA_URL);
  const namicorn = new Namicorn({ blockchain: { zns: ZILLIGA_URL } });
  const result = await namicorn.resolve('cofounding.zil');
  expect(result.addresses.ETH).toEqual(
    '0xaa91734f90795e80751c96e682a321bb3c1a4186',
  );
  expect(result.meta.owner).toEqual(
    '0x267ca17e8b3bbf49c52a4c3b473cdebcbaf9025e',
  );
  expect(result.meta.type).toEqual('zns');
  expect(result.meta.ttl).toEqual(0);
});

it('provides empty response constant', async () => {
  const response = Namicorn.UNCLAIMED_DOMAIN_RESPONSE;
  expect(response.addresses).toEqual({});
  expect(response.meta.owner).toEqual(null);
});

it('resolves non-existing domain zone', async () => {
  nock.cleanAll();
  const namicorn = new Namicorn({ blockchain: true });
  const result = await namicorn.address('bogdangusiev.qq', 'ZIL');
  expect(result).toEqual(null);
});

xit('resolves rsk name using blockchain', async () => {
  const namicorn = new Namicorn({ blockchain: true });
  const result = await namicorn.address('alice.rsk', 'ETH');
  expect(result).toEqual('0xd96d39c91b3d0236437e800f874800b026dc5f14');
});
