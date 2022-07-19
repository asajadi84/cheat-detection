const _ = require("lodash");
const fs = require("fs");
const papa = require("papaparse");

const examsFile = fs.readFileSync(__dirname + "/dataset/exams.csv", {encoding: "utf-8"});
const individualsFile = fs.readFileSync(__dirname + "/dataset/individuals.csv", {encoding: "utf-8"});

let examsFileArray;
papa.parse(examsFile, {
    header: true,
    complete: function(results){
        examsFileArray = results.data;
    }
});
let individualsFileArray;
papa.parse(individualsFile, {
    header: true,
    complete: function(results){
        individualsFileArray = results.data;
    }
});

let examsByExamID = _.groupBy(examsFileArray, "ExamID");
let studentScoreVsGPA = [];
_.forEach(examsByExamID, function(examSession){
    _.forEach(examSession, function(exam){
        if(exam.UserName.startsWith("s") && exam.FinalGrade != "0.00"){
            studentScoreVsGPA.push([
                exam.UserName, exam.FinalGrade, _.find(individualsFileArray, ["UserName", exam.UserName]).GPA
            ]);
        }
    });
});

let studentScoreVsGPASorted = _.sortBy(studentScoreVsGPA, o => [o[0], o[1]]);
let studentScoreVsGPAUniq = _.chain(studentScoreVsGPASorted)
.uniqWith((a, b) => a[0] == b[0]).shuffle().value();

let [testDataset, trainingDataset] = _.chunk(studentScoreVsGPAUniq, studentScoreVsGPAUniq.length/2);

let optimalKTable = [];
for(let k=1; k<testDataset.length; k++){
    for(let i=0; i<testDataset.length; i++){
        let knnResult = knn(testDataset[i], trainingDataset, k);
        optimalKTable.push({
            "k": k,
            "user name": testDataset[i][0],
            "user score": testDataset[i][1],
            "user actual GPA": testDataset[i][2],
            "user predicted GPA": knnResult,
            "algorithm accuracy (%)": accuracyPercentage(testDataset[i][2], knnResult)
        });
    }
}
console.table(optimalKTable, ["k", "user name", "user score", "user actual GPA", "user predicted GPA", "algorithm accuracy (%)"]);

function knn(testData, trainingDataset, k){
    let prediction = _.chain(trainingDataset)
    .map(row => [row[0], absDistance(row[1], testData[1]), row[2]])
    .sortBy(row => row[1])
    .slice(0, k)
    .sumBy(o => o[2]*1)
    .divide(k)
    .value();
    
    return prediction;
}

function absDistance(a, b){
    return Math.abs(a-b);
}

function accuracyPercentage(a, b){
    if(a>b){
        return (b/a)*100;
    }else{
        return (a/b)*100;
    }
}