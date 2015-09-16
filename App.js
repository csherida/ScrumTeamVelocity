Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [{ xtype: 'container', itemId: 'selector_box', defaults: { margin: 10 } }, { xtype: 'container', itemId: 'chart_box' }],
    launch: function () {
        var me = this;
        this.setLoading('Preparing data');

        Deft.Chain.pipeline([
            this._getIterations,
            this._getStories
        ]).then({
            scope: this,
            success: function (results) {
                this._makeButtons(results);
                //this._iterations = iterations;
            }
        }).always(function () {
            me.setLoading(false);
        });

    },
    _updateData: function (button, results) {
        this.selectedButton = button;
        this.down('#chart_box').removeAll();

        //this._getStories(this._iterations);
        this._processData(results[0], results[1]);
    },
    _getIterations: function () {
        var deferred = Ext.create('Deft.Deferred'); // if use Ext.Deft.Deferred, get "GET https://sandbox.rallydev.com/apps/2.0rc3/src/Deft/Deferred.js?_dc=1422572219088 404 (Not Found)"
        var filters = [
                { property: 'EndDate', value: Rally.util.DateTime.toIsoString(new Date()), operator: '<' }
        ];

        Ext.create('Rally.data.wsapi.Store', {
            model: 'Iteration',
            limit: 10,
            pageSize: 10,
            context: {
                projectScopeDown: false,
                projectScopeUp: false
            },
            sorters: [{
                property: 'EndDate', direction: 'DESC'
            }],
            autoLoad: true,
            filters: filters,
            fetch: ['Name', 'EndDate'],
            listeners: {
                scope: this,
                load: function (store, iterations, success) {
                    //process data
                    console.log(store.getTotalCount());
                    iterations = Ext.Array.sort(iterations, function (a, b) {
                        if (a.get('EndDate') < b.get('EndDate')) {
                            return -1;
                        }
                        if (a.get('EndDate') > b.get('EndDate')) {
                            return 1;
                        }
                        return 0;
                    });
                    deferred.resolve(iterations);
                }
            }
        });
        return deferred;
    },
    _makeButtons: function (iterationsAndStories) {
        var point_button = Ext.create('Rally.ui.Button', {
            text: 'Points',
            listeners: {
                click: function (button) {
                    this._updateData(button, iterationsAndStories);
                },
                scope: this
            }
        });
        var count_button = Ext.create('Rally.ui.Button', {
            text: 'Count',
            listeners: {
                click: function (button) {
                    this._updateData(button, iterationsAndStories);
                },
                scope: this
            }
        });
        
        this.down('#selector_box').add(point_button);
        this.down('#selector_box').add(count_button);

        // Preload the chart with the US count
        this._updateData(point_button, iterationsAndStories);
    },
    _convertToHash: function (items) {
        var hash = {};

        //Ext.Array.each(items, function (item) {
        //    item.set('_count_nf', 0);
        //    item.set('_count_f', 0);
        //    item.set('_count_other', 0);
        //    hash[item.get('Name')] = item;

        //});
        Ext.Array.each(items, function (item) {
            item.set('_count_program', 0);
            item.set('_count_nonprogram', 0);
            item.set('_count_prodsupp', 0);
            item.set('_count_orphan', 0);
            item.set('_count_defect', 0);
            hash[item.get('Name')] = item;

        });
        return hash;
    },
    _getStories: function (iterations) {
        var deferred = Ext.create('Deft.Deferred');
        var start_date = Rally.util.DateTime.toIsoString(iterations[0].get('EndDate'));
        var end_date = Rally.util.DateTime.toIsoString(iterations[iterations.length - 1].get('EndDate'));

        Ext.create('Rally.data.wsapi.artifact.Store', {
            models: ['User Story', 'Defect'],
            limit: Infinity,
            autoLoad: true,
            filters: [
                { operator: '<=', property: 'Iteration.EndDate', value: end_date },
                { property: 'Iteration.EndDate', operator: '>=', value: start_date },
                { property: 'ScheduleState', operator: '>=', value: 'Accepted' }
            ],
            fetch: ['Iteration', 'Name', 'PlanEstimate', 'c_RequirementType', 'c_Program', 'Feature', 'Project'],
            listeners: {
                scope: this,
                load: function (store, stories, success) {
                    // process data for non promises this._processData(stories, iterations);
                    deferred.resolve([stories, iterations]);
                }
            }
        });
        return deferred;
    },
    _processData: function (stories, iterations) {

        console.log(stories.length, stories);

        var iteration_hash = this._convertToHash(iterations);

        Ext.Array.each(stories, function (story) {
            var counter_field = '';
            var iteration_name = story.get('Iteration').Name;
            var program_field = 'Undefined';
            var iteration_object = iteration_hash[iteration_name];

            var program_field = story.get('c_Program');

            if (program_field === 'Production Support') {
                counter_field = '_count_prodsupp';
            }
            else if (story.get('_type') === 'defect') {
                counter_field = '_count_defect';
            }
            else if ((program_field === 'Platform Enhancements Initiative') || (program_field === 'NonProgram Intake')) {
                counter_field = '_count_nonprogram';
            }
            else if (program_field === 'Undefined') {
                counter_field = '_count_orphan';
            }
            else {
                counter_field = '_count_program';
            }

            var count = iteration_object.get(counter_field) || 0;

            if (this.selectedButton.text == 'Points') {
                var size = story.get('PlanEstimate') || 0;
                iteration_object.set(counter_field, count + size);
            }
            else {
                iteration_object.set(counter_field, count + 1);
            }

            iteration_hash[iteration_name] = iteration_object;

        }, this);

        console.log(iteration_hash);

        // { iteration_1:data_obj, iteration_2: data_obj}
        var chart_data = this._convertToChartData(iteration_hash);
        this._makeChart(chart_data);
        console.log(chart_data);
    },
    _convertToChartData: function (iteration_hash) {
        //IN
        // make a container to hold the result
        var categories = [];
        var series = [];

        var count_fields = {
            "Program Stories": '_count_program',
            "Non Program Stories": '_count_nonprogram',
            "Orphans": '_count_orphan',
            "ProdSupps": '_count_prodsupp',
            "Defects": '_count_defect'
        };
        //put iteration name into the categories array
        //iterate over series in hash
        Ext.Object.each(iteration_hash, function (sprint_name, iteration_object) {
            categories.push(sprint_name);
        });

        //iterate over the types of things we counted to make the different parts of the bar
        //charts
        Ext.Object.each(count_fields, function (count_name, count_field) {
            var s = {
                type: 'column',
                stack: '1',
                name: count_name,
                data: []
            };
            Ext.Object.each(iteration_hash, function (sprint_name, iteration_object) {
                s.data.push(iteration_object.get(count_field));
            });
            series.push(s);
        });

        return { series: series, categories: categories };
    },
    _makeChart: function (chart_data) {

        var categories = chart_data.categories;
        var series = chart_data.series;

        this.down('#chart_box').add({
            xtype: 'rallychart',
            loadMask: false, // removes sparkler
            chartData: {
                series: series
            },
            chartConfig: {
                chart: {},
                title: {
                    text: 'Scrum Team Velocity By Program/Non-Program',
                    align: 'center'
                },
                xAxis: [{
                    categories: categories,
                    labels: {
                        align: 'left',
                        rotation: 70
                    }
                }],
                plotOptions: {
                    series: {
                        stacking: 'normal'
                    }
                }
            }
        });
    }

});
