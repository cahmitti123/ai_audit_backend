/**
 * Test Webhook Endpoints
 * =======================
 * Script to test webhook functionality
 */

import axios from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:3500';

interface TestResult {
  name: string;
  success: boolean;
  message?: string;
  error?: string;
}

async function testWebhook(
  name: string,
  endpoint: string,
  data?: any
): Promise<TestResult> {
  try {
    const response = await axios.post(`${API_URL}${endpoint}`, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });

    return {
      name,
      success: response.data.success,
      message: response.data.message || JSON.stringify(response.data),
    };
  } catch (error: any) {
    return {
      name,
      success: false,
      error: error.message,
    };
  }
}

async function runTests() {
  console.log('🧪 Testing Webhook Endpoints\n');
  console.log(`API URL: ${API_URL}\n`);

  const tests = [
    // Test individual event types
    {
      name: 'Notification Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'notification' },
    },
    {
      name: 'Audit Started Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'audit.started' },
    },
    {
      name: 'Audit Progress Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'audit.progress' },
    },
    {
      name: 'Audit Completed Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'audit.completed' },
    },
    {
      name: 'Transcription Progress Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'transcription.progress' },
    },
    {
      name: 'Batch Progress Event',
      endpoint: '/api/webhooks/test',
      data: { eventType: 'batch.progress' },
    },
  ];

  console.log('📋 Running individual event tests...\n');

  for (const test of tests) {
    const result = await testWebhook(test.name, test.endpoint, test.data);
    
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    
    if (result.message) {
      console.log(`   ${result.message}`);
    }
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
    console.log('');
  }

  // Test all events at once
  console.log('📦 Testing all events at once...\n');
  const allResult = await testWebhook(
    'All Events',
    '/api/webhooks/test',
    { eventType: 'all' }
  );
  
  const allIcon = allResult.success ? '✅' : '❌';
  console.log(`${allIcon} ${allResult.name}`);
  console.log(`   ${allResult.message || allResult.error}\n`);

  // Test workflow simulation
  console.log('🔄 Testing workflow simulation...\n');
  const workflowResult = await testWebhook(
    'Audit Workflow Simulation',
    '/api/webhooks/test/workflow',
    { delay: 1000 }
  );
  
  const workflowIcon = workflowResult.success ? '✅' : '❌';
  console.log(`${workflowIcon} ${workflowResult.name}`);
  console.log(`   ${workflowResult.message || workflowResult.error}\n`);

  // Test custom webhook
  console.log('🎨 Testing custom webhook...\n');
  const customResult = await testWebhook(
    'Custom Webhook',
    '/api/webhooks/test/custom',
    {
      event: 'notification',
      data: {
        type: 'info',
        message: 'Custom Test Message',
        description: 'This is a custom webhook test',
      },
      source: 'test-script',
    }
  );
  
  const customIcon = customResult.success ? '✅' : '❌';
  console.log(`${customIcon} ${customResult.name}`);
  console.log(`   ${customResult.message || customResult.error}\n`);

  console.log('✨ Testing complete!\n');
  console.log('💡 Check your frontend to see if the webhooks were received.\n');
}

// Run tests
runTests().catch((error) => {
  console.error('❌ Test script failed:', error);
  process.exit(1);
});

