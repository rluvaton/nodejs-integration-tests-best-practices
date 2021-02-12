const amqplib = require('amqplib');
const request = require('supertest');
const sinon = require('sinon');
const nock = require('nock');
const {
  initializeWebServer,
  stopWebServer,
} = require('../../example-application/entry-points/api');
const messageQueueClient = require('../../example-application/libraries/message-queue-client');
const {
  MessageQueueStarter,
} = require('../../example-application/entry-points/message-queue-starter');
const { default: Axios } = require('axios');

let expressApp, messageQueueClientStub;

beforeAll(async (done) => {
  // ️️️✅ Best Practice: Place the backend under test within the same process
  expressApp = await initializeWebServer();

  // ️️️✅ Best Practice: Ensure that this component is isolated by preventing unknown calls
  nock.disableNetConnect();
  nock.enableNetConnect('127.0.0.1');

  done();
});

beforeEach(() => {
  nock('http://localhost/user/').get(`/1`).reply(200, {
    id: 1,
    name: 'John',
  });
  nock('https://mailer.com')
    .post('/send', (payload) => ((emailPayload = payload), true))
    .reply(202);
  messageQueueClientStub = sinon.stub(messageQueueClient);
});

afterEach(() => {
  nock.cleanAll();
  sinon.restore();
});

afterAll(async (done) => {
  // ️️️✅ Best Practice: Clean-up resources after each run
  await stopWebServer();
  //await messageQueueClient.close();
  nock.enableNetConnect();
  done();
});

test('When adding a new valid order, a message is put in queue', async () => {
  //Arrange
  const orderToAdd = {
    userId: 1,
    productId: 2,
    mode: 'approved',
  };
  messageQueueClientStub.sendMessage.returns(Promise.resolve({}));

  //Act
  await request(expressApp).post('/order').send(orderToAdd);

  //Assert
  expect(messageQueueClientStub.sendMessage.called).toBe(true);
});

// ️️️✅ Best Practice: Ensure that your app stop early enough when a poisoned 💉 message arrives
test('When a poisoned message arrives, then it being ignored', async () => {
  // Arrange
  const messageWithInvalidSchema = { id: 650 };

  // Make the message queue client fire a new message also there is no real queue
  messageQueueClientStub.consume.callsFake(
    async (queueName, onMessageCallback) => {
      await onMessageCallback(JSON.stringify(messageWithInvalidSchema));
    }
  );

  // Assert
  const messageQueueStarter = new MessageQueueStarter();
  messageQueueStarter.on('message-handled', async () => {
    done();
  });

  // Act
  messageQueueStarter.start();
});

test('When a user deletion message arrive, then his orders are deleted', async (done) => {
  // Arrange
  const orderToAdd = {
    userId: 1,
    productId: 2,
    mode: 'approved',
  };
  const {
    body: { id: addedOrderId },
  } = await request(expressApp).post('/order').send(orderToAdd);
  console.log('1', addedOrderId);

  // Make the message queue client fire a new message also there is no real queue
  messageQueueClientStub.consume.callsFake(
    async (queueName, onMessageCallback) => {
      console.log('2', addedOrderId);
      await onMessageCallback(JSON.stringify({ id: addedOrderId }));
    }
  );

  // Assert
  const messageQueueStarter = new MessageQueueStarter();
  messageQueueStarter.on('message-handled', async () => {
    console.log('3', addedOrderId);
    const deletedOrder = await request(expressApp).get(
      `/order/${addedOrderId}`
    );
    expect(deletedOrder.body).toEqual({});
    done();
  });

  // Act
  messageQueueStarter.start();
});

test('fpp', async (done) => {
  // Arrange
  const orderToAdd = {
    userId: 1,
    productId: 2,
    mode: 'approved',
  };
  const {
    body: { id: addedOrderId },
  } = await request(expressApp).post('/order').send(orderToAdd);
  console.log('1', addedOrderId);

  // Make the message queue client fire a new message also there is no real queue
  sinon
    .stub(amqplib.cha, 'consume')
    .callsFake(async (queueName, onMessageCallback) => {
      console.log('2', addedOrderId);
      await onMessageCallback(JSON.stringify({ id: addedOrderId }));
    });

  // Assert
  const messageQueueStarter = new MessageQueueStarter();
  messageQueueStarter.on('message-handled', async () => {
    console.log('3', addedOrderId);
    const deletedOrder = await request(expressApp).get(
      `/order/${addedOrderId}`
    );
    expect(deletedOrder.body).toEqual({});
    done();
  });

  // Act
  messageQueueStarter.start();
});

test.todo('When an error occurs, then the message is not acknowledged');
test.todo(
  'When a new valid user-deletion message is processes, then the message is acknowledged'
);
test.todo(
  'When two identical create-order messages arrives, then the app is idempotent and only one is created'
);